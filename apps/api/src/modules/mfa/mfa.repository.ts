import { pool } from '../../db/pool.js';

export interface MfaRow {
  user_id: string;
  secret_enc: string;
  pending: boolean;
  enabled_at: Date | null;
  last_used_step: string | null;
}

export interface ChallengeRow {
  id: string;
  user_id: string;
  source: 'password' | 'google';
  attempts: number;
}

export const mfaRepository = {
  async get(userId: string): Promise<MfaRow | undefined> {
    return (await pool.query<MfaRow>('SELECT user_id, secret_enc, pending, enabled_at, last_used_step::text FROM user_mfa WHERE user_id = $1', [userId])).rows[0];
  },

  /** Crea o reemplaza el secreto PENDIENTE. No toca un MFA ya activo. */
  async upsertPending(userId: string, secretEnc: string): Promise<boolean> {
    const r = await pool.query(
      `INSERT INTO user_mfa(user_id, secret_enc, pending) VALUES ($1,$2,true)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_used_step = NULL, created_at = now() WHERE user_mfa.pending`,
      [userId, secretEnc],
    );
    return (r.rowCount ?? 0) > 0;
  },

  /** Activa MFA y guarda los códigos de recuperación (solo hashes), en una transacción. */
  async enable(userId: string, step: number, hashes: string[]): Promise<boolean> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query("UPDATE user_mfa SET pending = false, enabled_at = now(), last_used_step = $2 WHERE user_id = $1 AND pending", [userId, step]);
      if (!u.rowCount) { await c.query('ROLLBACK'); return false; }
      await c.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
      for (const h of hashes) await c.query('INSERT INTO mfa_recovery_codes(user_id, code_hash) VALUES ($1,$2)', [userId, h]);
      await c.query('COMMIT');
      return true;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  /** Registra el paso TOTP usado; falla (false) si ya se había usado ese paso u otro posterior (reutilización / carrera). */
  async useStep(userId: string, step: number): Promise<boolean> {
    const r = await pool.query('UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1 AND NOT pending AND (last_used_step IS NULL OR last_used_step < $2)', [userId, step]);
    return (r.rowCount ?? 0) > 0;
  },

  /** Consume un código de recuperación (un solo uso, atómico). */
  async useRecovery(userId: string, hash: string): Promise<boolean> {
    const r = await pool.query('UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL', [userId, hash]);
    return (r.rowCount ?? 0) > 0;
  },
  async recoveryRemaining(userId: string): Promise<number> {
    return (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [userId])).rows[0]!.n;
  },
  async replaceRecovery(userId: string, hashes: string[]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
      for (const h of hashes) await c.query('INSERT INTO mfa_recovery_codes(user_id, code_hash) VALUES ($1,$2)', [userId, h]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  async disable(userId: string) {
    await pool.query('DELETE FROM user_mfa WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
    await pool.query('UPDATE mfa_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [userId]);
  },

  // ---- Desafíos de login ----
  async createChallenge(userId: string, tokenHash: string, source: 'password' | 'google', ip: string | undefined, expiresAt: Date) {
    await pool.query('UPDATE mfa_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [userId]); // un solo desafío vivo por usuario
    await pool.query('INSERT INTO mfa_challenges(user_id, token_hash, source, ip, expires_at) VALUES ($1,$2,$3,$4,$5)', [userId, tokenHash, source, ip ?? null, expiresAt]);
  },
  async findChallenge(tokenHash: string): Promise<(ChallengeRow & { expires_at: Date }) | undefined> {
    return (await pool.query(
      'SELECT id, user_id, source, attempts, expires_at FROM mfa_challenges WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()', [tokenHash])).rows[0];
  },
  async addAttempt(id: string): Promise<number> {
    return (await pool.query<{ attempts: number }>('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [id])).rows[0]!.attempts;
  },
  async consumeChallenge(id: string): Promise<boolean> {
    return ((await pool.query('UPDATE mfa_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [id])).rowCount ?? 0) > 0;
  },

  /** Fallos de MFA recientes del usuario (ventana deslizante) para el bloqueo por fuerza bruta. */
  async recentFailures(userId: string, minutes = 15): Promise<number> {
    return (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1 AND action = 'auth.mfa_failed' AND created_at > now() - make_interval(mins => $2)", [userId, minutes])).rows[0]!.n;
  },

  async revokeOtherSessions(userId: string, keepTokenHash: string | null) {
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR token_hash <> $2)', [userId, keepTokenHash]);
  },
  async promoteSession(tokenHash: string) {
    await pool.query("UPDATE sessions SET scope = 'full', mfa_verified_at = now() WHERE token_hash = $1", [tokenHash]);
  },
};
