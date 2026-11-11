import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

export interface UserRow {
  id: string;
  email: string;
  username: string;
  email_verified: boolean;
  password_hash: string | null;
  role: string;
  display_name: string;
  avatar_key?: string | null;
  mfa_enabled: boolean;
  /** Solo cuando el usuario se cargó desde una sesión. */
  session_scope?: 'full' | 'mfa_setup';
  session_created_at?: Date;
}

const selectUser = `SELECT u.id, u.email, u.username, u.email_verified, u.password_hash, u.role, p.display_name, p.avatar_key,
  EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = u.id AND NOT m.pending) AS mfa_enabled
  FROM users u JOIN profiles p ON p.user_id = u.id`;

export const authRepository = {
  async findByIdentifier(identifier: string): Promise<UserRow | undefined> {
    const r = await pool.query<UserRow>(`${selectUser} WHERE u.deleted_at IS NULL AND (u.email = $1 OR u.username = $1) LIMIT 1`, [identifier]);
    return r.rows[0];
  },

  async findById(id: string): Promise<UserRow | undefined> {
    const r = await pool.query<UserRow>(`${selectUser} WHERE u.deleted_at IS NULL AND u.id = $1`, [id]);
    return r.rows[0];
  },

  async usernameTaken(username: string): Promise<boolean> {
    const r = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    return r.rowCount! > 0;
  },

  /** Crea usuario + perfil en una transacción. Lanza el error de pg 23505 si el email/username existe. */
  async createUser(input: { email: string; username: string; passwordHash: string; displayName: string }): Promise<UserRow> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const u = await client.query<{ id: string }>(
        'INSERT INTO users(email, username, password_hash) VALUES ($1,$2,$3) RETURNING id',
        [input.email, input.username, input.passwordHash],
      );
      const id = u.rows[0]!.id;
      await client.query('INSERT INTO profiles(user_id, display_name) VALUES ($1,$2)', [id, input.displayName]);
      await client.query('COMMIT');
      return {
        id,
        email: input.email,
        username: input.username,
        email_verified: false,
        password_hash: input.passwordHash,
        role: 'user',
        display_name: input.displayName,
        mfa_enabled: false,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async createSession(s: { userId: string; tokenHash: string; ip?: string; userAgent?: string; expiresAt: Date; scope?: 'full' | 'mfa_setup'; mfaVerified?: boolean }) {
    await pool.query("INSERT INTO sessions(user_id, token_hash, ip, user_agent, expires_at, scope, mfa_verified_at) VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7 THEN now() END)", [
      s.userId,
      s.tokenHash,
      s.ip ?? null,
      s.userAgent?.slice(0, 300) ?? null,
      s.expiresAt,
      s.scope ?? 'full',
      s.mfaVerified ?? false,
    ]);
  },

  async findUserBySessionHash(tokenHash: string): Promise<UserRow | undefined> {
    const r = await pool.query<UserRow>(
      `SELECT u.id, u.email, u.username, u.email_verified, u.password_hash, u.role, p.display_name, p.avatar_key,
         EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = u.id AND NOT m.pending) AS mfa_enabled,
         s.scope AS session_scope, s.created_at AS session_created_at
       FROM users u JOIN profiles p ON p.user_id = u.id JOIN sessions s ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL`,
      [tokenHash],
    );
    return r.rows[0];
  },

  async revokeSession(tokenHash: string) {
    await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]);
  },

  async audit(userId: string | null, action: string, ip?: string, meta: Record<string, unknown> = {}) {
    await pool.query('INSERT INTO audit_log(user_id, action, ip, meta) VALUES ($1,$2,$3,$4)', [userId, action, ip ?? null, meta]);
  },
};
