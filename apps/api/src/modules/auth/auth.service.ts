import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../../middleware/errors.js';
import { authRepository, type UserRow } from './auth.repository.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';
import { verifyRecaptcha } from './recaptcha.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Argon2id con parámetros OWASP (19 MiB, t=2, p=1); la sal aleatoria de 16 bytes es única por contraseña y va embebida en el hash.
export const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const ARGON = ARGON_OPTIONS;
// Hash ficticio para igualar tiempos cuando el usuario no existe (evita enumeración por temporización).
const dummyHash = argon2.hash('dummy-password-for-timing', ARGON);

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  role: string;
  mfaEnabled: boolean;
  /** Los administradores deben tener MFA activo. */
  mfaRequired: boolean;
}
export const toPublic = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  username: u.username,
  displayName: u.display_name,
  avatarUrl: u.avatar_key ? `/api/media/avatar/${u.id}?v=${encodeURIComponent(u.avatar_key.split('/').pop()!.split('.')[0]!)}` : null,
  emailVerified: u.email_verified,
  role: u.role,
  mfaEnabled: u.mfa_enabled,
  mfaRequired: u.role === 'admin',
});

interface Ctx {
  ip?: string;
  userAgent?: string;
}

export async function openSession(user: UserRow, ctx: Ctx, opts: { scope?: 'full' | 'mfa_setup'; mfaVerified?: boolean } = {}) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await authRepository.createSession({ userId: user.id, tokenHash: hashToken(token), ip: ctx.ip, userAgent: ctx.userAgent, expiresAt, ...opts });
  return { token, expiresAt };
}

export const authService = {
  async register(input: RegisterInput, ctx: Ctx) {
    await verifyRecaptcha(input.captchaToken, ctx.ip);
    const passwordHash = await argon2.hash(input.password, ARGON);
    let user: UserRow;
    try {
      user = await authRepository.createUser({ email: input.email, username: input.username, passwordHash, displayName: input.displayName });
    } catch (e) {
      const err = e as { code?: string; constraint?: string };
      if (err.code === '23505') {
        const field = err.constraint?.includes('username') ? 'username' : 'email';
        throw new HttpError(409, field === 'username' ? 'Ese nombre de usuario ya está en uso' : 'Ya existe una cuenta con ese correo', `${field}_taken`);
      }
      throw e;
    }
    await authRepository.audit(user.id, 'auth.register', ctx.ip);
    return { user: toPublic(user), session: await openSession(user, ctx) };
  },

  async login(input: LoginInput, ctx: Ctx) {
    await verifyRecaptcha(input.captchaToken, ctx.ip);
    const user = await authRepository.findByIdentifier(input.identifier);
    const hash = user?.password_hash ?? (await dummyHash);
    const ok = await argon2.verify(hash, input.password).catch(() => false);
    if (!user || !user.password_hash || !ok) {
      await authRepository.audit(user?.id ?? null, 'auth.login_failed', ctx.ip);
      throw new HttpError(401, 'Credenciales incorrectas', 'invalid_credentials');
    }
    await authRepository.audit(user.id, 'auth.login', ctx.ip);
    return user; // la ruta decide si abre sesión o exige el segundo factor
  },

  async logout(token: string | undefined) {
    if (token) await authRepository.revokeSession(hashToken(token));
  },

  async userFromToken(token: string | undefined): Promise<UserRow | undefined> {
    if (!token) return undefined;
    return authRepository.findUserBySessionHash(hashToken(token));
  },

  usernameAvailable: async (u: string) => !(await authRepository.usernameTaken(u)),
};
