import { pool } from '../../db/pool.js';
import type { UserRow } from './auth.repository.js';

export type TokenPurpose = 'verify_email' | 'reset_password';
export type TokenFailure = 'invalid' | 'used' | 'expired';

async function failureReason(hash: string, purpose: TokenPurpose): Promise<TokenFailure> {
  const r = await pool.query<{ used_at: Date | null; expired: boolean }>(
    'SELECT used_at, expires_at <= now() AS expired FROM email_tokens WHERE token_hash = $1 AND purpose = $2',
    [hash, purpose],
  );
  const row = r.rows[0];
  if (!row) return 'invalid';
  if (row.used_at) return 'used';
  return row.expired ? 'expired' : 'invalid';
}

export const tokensRepository = {
  /** Emite un token (solo se guarda su hash) e invalida los anteriores del mismo propósito. */
  async issue(userId: string, purpose: TokenPurpose, tokenHash: string, expiresAt: Date, ip?: string) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL', [userId, purpose]);
      await c.query('INSERT INTO email_tokens(user_id, purpose, token_hash, expires_at, ip) VALUES ($1,$2,$3,$4,$5)', [userId, purpose, tokenHash, expiresAt, ip ?? null]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  async lastIssuedAt(userId: string, purpose: TokenPurpose): Promise<Date | undefined> {
    const r = await pool.query<{ created_at: Date }>('SELECT created_at FROM email_tokens WHERE user_id = $1 AND purpose = $2 ORDER BY created_at DESC LIMIT 1', [userId, purpose]);
    return r.rows[0]?.created_at;
  },

  /** Uso único y atómico: marca el token como usado y confirma el correo. */
  async verifyEmail(hash: string): Promise<{ ok: true; userId: string } | { ok: false; reason: TokenFailure }> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query<{ user_id: string }>(
        "UPDATE email_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > now() RETURNING user_id",
        [hash],
      );
      if (!t.rows[0]) {
        await c.query('ROLLBACK');
        return { ok: false, reason: await failureReason(hash, 'verify_email') };
      }
      await c.query('UPDATE users SET email_verified = true WHERE id = $1', [t.rows[0].user_id]);
      await c.query('COMMIT');
      return { ok: true, userId: t.rows[0].user_id };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  async resetStatus(hash: string): Promise<'ok' | TokenFailure> {
    const r = await pool.query('SELECT 1 FROM email_tokens WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()', [hash, 'reset_password']);
    return r.rowCount ? 'ok' : failureReason(hash, 'reset_password');
  },

  /** Cambia la contraseña, consume el token, confirma el correo y revoca TODAS las sesiones, en una transacción. */
  async resetPassword(hash: string, passwordHash: string): Promise<{ ok: true; userId: string } | { ok: false; reason: TokenFailure }> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const t = await c.query<{ user_id: string }>(
        "UPDATE email_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > now() RETURNING user_id",
        [hash],
      );
      const userId = t.rows[0]?.user_id;
      if (!userId) {
        await c.query('ROLLBACK');
        return { ok: false, reason: await failureReason(hash, 'reset_password') };
      }
      await c.query('UPDATE users SET password_hash = $2, email_verified = true WHERE id = $1', [userId, passwordHash]);
      await c.query("UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [userId]);
      await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await c.query('COMMIT');
      return { ok: true, userId };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },
};

export const googleRepository = {
  async findBySub(sub: string): Promise<UserRow | undefined> {
    const r = await pool.query<UserRow>(
      `SELECT u.id, u.email, u.username, u.email_verified, u.password_hash, u.role, p.display_name, p.avatar_key,
         EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = u.id AND NOT m.pending) AS mfa_enabled
       FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.google_sub = $1 AND u.deleted_at IS NULL`,
      [sub],
    );
    return r.rows[0];
  },

  /**
   * Vincula Google a una cuenta local. Si la cuenta local tenía el correo SIN verificar, se anula su contraseña y se
   * revocan sus sesiones: quien la creó no demostró ser dueño del correo (evita la toma de cuenta por pre-registro).
   */
  async link(userId: string, sub: string, wasUnverified: boolean) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('UPDATE users SET google_sub = $2, email_verified = true WHERE id = $1', [userId, sub]);
      if (wasUnverified) {
        await c.query('UPDATE users SET password_hash = NULL WHERE id = $1', [userId]);
        await c.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  async createUser(input: { email: string; username: string; sub: string; displayName: string }): Promise<string> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const u = await c.query<{ id: string }>('INSERT INTO users(email, username, google_sub, email_verified) VALUES ($1,$2,$3,true) RETURNING id', [input.email, input.username, input.sub]);
      await c.query('INSERT INTO profiles(user_id, display_name) VALUES ($1,$2)', [u.rows[0]!.id, input.displayName.slice(0, 60) || input.username]);
      await c.query('COMMIT');
      return u.rows[0]!.id;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },
};
