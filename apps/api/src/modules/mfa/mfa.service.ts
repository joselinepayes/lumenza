import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { HttpError } from '../../middleware/errors.js';
import { authRepository, type UserRow } from '../auth/auth.repository.js';
import { hashToken } from '../auth/auth.service.js';
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecovery, mfaAvailable, normalizeRecovery } from './mfa.crypto.js';
import { mfaRepository } from './mfa.repository.js';

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;
export const MAX_FAILURES_PER_WINDOW = 10; // por usuario, 15 min
export const RECENT_AUTH_MS = 10 * 60 * 1000;
const ISSUER = 'LUMENZA';

export type LoginGate = 'ok' | 'mfa' | 'admin_enroll';

interface Ctx {
  ip?: string;
}
interface Reauth {
  password?: string;
  sessionCreatedAt?: Date;
}
export interface FactorInput {
  code?: string;
  recoveryCode?: string;
}

const requireAvailable = () => {
  if (!mfaAvailable()) throw new HttpError(503, 'La autenticación multifactor no está configurada en este entorno', 'mfa_not_configured');
};

/** Verifica un TOTP (ventana ±1 paso) y devuelve el paso coincidente, o null. Comparación en tiempo constante (otplib). */
function matchTotp(secret: string, token: string): number | null {
  if (!/^\d{6}$/.test(token)) return null;
  const r = verifySync({ secret, token, epochTolerance: 30 }) as { valid: boolean; timeStep?: number; epoch?: number; delta?: number };
  if (!r.valid) return null;
  // timeStep identifica el paso coincidente (-1/0/+1): base del control anti-reutilización
  return r.timeStep ?? Math.floor((r.epoch ?? Date.now() / 1000) / 30) + (r.epoch === undefined ? (r.delta ?? 0) : 0);
}

export const mfaService = {
  available: mfaAvailable,

  async isEnabled(userId: string): Promise<boolean> {
    const m = await mfaRepository.get(userId);
    return Boolean(m && !m.pending);
  },

  /** ¿Qué debe ocurrir tras validar la contraseña / Google? Los administradores deben tener MFA. */
  async gate(user: UserRow): Promise<LoginGate> {
    // Se consulta SIEMPRE la BD (no un campo opcional del objeto): ninguna ruta de login puede saltarse el MFA por omisión de datos
    if (await this.isEnabled(user.id)) return 'mfa';
    if (user.role === 'admin') return 'admin_enroll';
    return 'ok';
  },

  /** Crea un desafío de un solo uso (10 min). El token va en una cookie HttpOnly; en BD solo su SHA-256. */
  async startChallenge(user: UserRow, source: 'password' | 'google', ctx: Ctx) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await mfaRepository.createChallenge(user.id, hashToken(token), source, ctx.ip, expiresAt);
    await authRepository.audit(user.id, 'auth.mfa_challenge', ctx.ip, { source });
    return { token, expiresAt };
  },

  async challengeInfo(token: string | undefined) {
    if (!token) return undefined;
    const c = await mfaRepository.findChallenge(hashToken(token));
    return c && { source: c.source, expiresAt: c.expires_at, attemptsLeft: Math.max(0, MAX_CHALLENGE_ATTEMPTS - c.attempts) };
  },

  /** Bloqueo temporal por exceso de fallos recientes (aplica incluso a códigos correctos). */
  async assertNotLocked(userId: string, ctx: Ctx) {
    if ((await mfaRepository.recentFailures(userId)) >= MAX_FAILURES_PER_WINDOW) {
      await authRepository.audit(userId, 'auth.mfa_locked', ctx.ip);
      throw new HttpError(429, 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo', 'mfa_locked');
    }
  },

  async fail(userId: string, reason: string, ctx: Ctx) {
    await authRepository.audit(userId, 'auth.mfa_failed', ctx.ip, { reason });
  },

  /**
   * Comprueba UN factor (TOTP o código de recuperación) con anti-reutilización atómica.
   * Devuelve el método usado; lanza 401 si no es válido.
   */
  async checkFactor(userId: string, input: FactorInput, ctx: Ctx): Promise<'totp' | 'recovery'> {
    const m = await mfaRepository.get(userId);
    if (!m || m.pending) throw new HttpError(409, 'La autenticación multifactor no está activa', 'mfa_not_enabled');
    if (input.code) {
      const secret = decryptSecret(m.secret_enc, userId);
      const step = matchTotp(secret, input.code.replace(/\s/g, ''));
      if (step !== null && (await mfaRepository.useStep(userId, step))) return 'totp';
      await this.fail(userId, step === null ? 'bad_totp' : 'totp_replay', ctx);
      throw new HttpError(401, 'Código incorrecto o ya utilizado', 'invalid_code');
    }
    if (input.recoveryCode) {
      const rc = normalizeRecovery(input.recoveryCode);
      if (rc && (await mfaRepository.useRecovery(userId, hashRecovery(rc)))) {
        await authRepository.audit(userId, 'auth.mfa_recovery_used', ctx.ip);
        return 'recovery';
      }
      await this.fail(userId, 'bad_recovery', ctx);
      throw new HttpError(401, 'Código de recuperación incorrecto o ya utilizado', 'invalid_code');
    }
    throw new HttpError(400, 'Indica un código de verificación', 'code_required');
  },

  /** Segundo paso del login: valida el desafío y un factor. Devuelve el usuario cuando todo es correcto. */
  async completeChallenge(token: string | undefined, input: FactorInput, ctx: Ctx) {
    if (!token) throw new HttpError(401, 'La verificación expiró. Inicia sesión de nuevo', 'challenge_expired');
    const ch = await mfaRepository.findChallenge(hashToken(token));
    if (!ch) throw new HttpError(401, 'La verificación expiró. Inicia sesión de nuevo', 'challenge_expired');
    await this.assertNotLocked(ch.user_id, ctx);
    if (ch.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      await mfaRepository.consumeChallenge(ch.id);
      throw new HttpError(401, 'Demasiados intentos. Inicia sesión de nuevo', 'challenge_expired');
    }
    let method: 'totp' | 'recovery';
    try {
      method = await this.checkFactor(ch.user_id, input, ctx);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'invalid_code') {
        const n = await mfaRepository.addAttempt(ch.id);
        if (n >= MAX_CHALLENGE_ATTEMPTS) {
          await mfaRepository.consumeChallenge(ch.id);
          throw new HttpError(401, 'Demasiados intentos. Inicia sesión de nuevo', 'challenge_expired');
        }
        throw new HttpError(401, `${e.message}. Te quedan ${MAX_CHALLENGE_ATTEMPTS - n} intentos`, 'invalid_code');
      }
      throw e;
    }
    if (!(await mfaRepository.consumeChallenge(ch.id))) throw new HttpError(401, 'La verificación expiró. Inicia sesión de nuevo', 'challenge_expired');
    const user = await authRepository.findById(ch.user_id);
    if (!user) throw new HttpError(401, 'La verificación expiró. Inicia sesión de nuevo', 'challenge_expired');
    await authRepository.audit(user.id, 'auth.mfa_login', ctx.ip, { method, source: ch.source });
    return { user, method, recoveryRemaining: method === 'recovery' ? await mfaRepository.recoveryRemaining(user.id) : undefined };
  },

  /** Autenticación reciente: contraseña vigente (si existe) o, en cuentas solo-Google, sesión iniciada hace ≤ 10 min. */
  async reauth(user: UserRow, r: Reauth, ctx: Ctx) {
    await this.assertNotLocked(user.id, ctx);
    if (user.password_hash) {
      const ok = r.password ? await argon2.verify(user.password_hash, r.password).catch(() => false) : false;
      if (!ok) {
        await this.fail(user.id, 'bad_password', ctx);
        throw new HttpError(401, 'Contraseña incorrecta', 'invalid_password');
      }
      return;
    }
    if (!r.sessionCreatedAt || Date.now() - r.sessionCreatedAt.getTime() > RECENT_AUTH_MS) {
      throw new HttpError(401, 'Por seguridad, vuelve a iniciar sesión para continuar', 'reauth_required');
    }
  },

  async status(user: UserRow) {
    const m = await mfaRepository.get(user.id);
    const enabled = Boolean(m && !m.pending);
    return {
      available: mfaAvailable(),
      enabled,
      enabledAt: enabled ? m!.enabled_at : null,
      recoveryRemaining: enabled ? await mfaRepository.recoveryRemaining(user.id) : 0,
      requiredForRole: user.role === 'admin',
      needsPassword: Boolean(user.password_hash),
    };
  },

  async setup(user: UserRow, r: Reauth, ctx: Ctx) {
    requireAvailable();
    if (await this.isEnabled(user.id)) throw new HttpError(409, 'La autenticación multifactor ya está activa', 'mfa_already_enabled');
    await this.reauth(user, r, ctx);
    const secret = generateSecret(); // 160 bits, base32
    if (!(await mfaRepository.upsertPending(user.id, encryptSecret(secret, user.id)))) throw new HttpError(409, 'La autenticación multifactor ya está activa', 'mfa_already_enabled');
    const otpauthUrl = generateURI({ issuer: ISSUER, label: user.email, secret });
    // QR negro sobre blanco (máxima compatibilidad de lectura con Google/Microsoft Authenticator)
    const qr = await QRCode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 2, width: 264, color: { dark: '#0B0B10', light: '#FFFFFF' } });
    await authRepository.audit(user.id, 'auth.mfa_setup_started', ctx.ip);
    return { secret, otpauthUrl, qrDataUrl: qr, issuer: ISSUER, account: user.email };
  },

  /** Confirma el secreto pendiente con un código válido y activa MFA; devuelve los códigos de recuperación (una sola vez). */
  async enable(user: UserRow, code: string, ctx: Ctx) {
    requireAvailable();
    await this.assertNotLocked(user.id, ctx);
    const m = await mfaRepository.get(user.id);
    if (!m) throw new HttpError(409, 'Primero inicia la configuración', 'mfa_not_started');
    if (!m.pending) throw new HttpError(409, 'La autenticación multifactor ya está activa', 'mfa_already_enabled');
    const step = matchTotp(decryptSecret(m.secret_enc, user.id), code.replace(/\s/g, ''));
    if (step === null) {
      await this.fail(user.id, 'bad_enable_code', ctx);
      throw new HttpError(400, 'El código no es válido. Comprueba la hora de tu dispositivo e inténtalo de nuevo', 'invalid_code');
    }
    const codes = generateRecoveryCodes(10);
    if (!(await mfaRepository.enable(user.id, step, codes.map((c) => hashRecovery(c))))) throw new HttpError(409, 'La autenticación multifactor ya está activa', 'mfa_already_enabled');
    await authRepository.audit(user.id, 'auth.mfa_enabled', ctx.ip);
    return codes;
  },

  async disable(user: UserRow, r: Reauth, factor: FactorInput, ctx: Ctx) {
    if (user.role === 'admin') throw new HttpError(403, 'La autenticación multifactor es obligatoria para administradores', 'mfa_required_for_admin');
    await this.reauth(user, r, ctx);
    await this.checkFactor(user.id, factor, ctx);
    await mfaRepository.disable(user.id);
    await authRepository.audit(user.id, 'auth.mfa_disabled', ctx.ip);
  },

  async regenerate(user: UserRow, r: Reauth, factor: FactorInput, ctx: Ctx) {
    await this.reauth(user, r, ctx);
    await this.checkFactor(user.id, factor, ctx);
    const codes = generateRecoveryCodes(10);
    await mfaRepository.replaceRecovery(user.id, codes.map((c) => hashRecovery(c)));
    await authRepository.audit(user.id, 'auth.mfa_recovery_regenerated', ctx.ip);
    return codes;
  },
};
