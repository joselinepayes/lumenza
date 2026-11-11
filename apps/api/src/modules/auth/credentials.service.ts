import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { HttpError } from '../../middleware/errors.js';
import { trySend, type Mailer } from '../../mail/mailer.js';
import { resetPasswordMail, verifyEmailMail } from '../../mail/templates.js';
import { authRepository } from './auth.repository.js';
import { ARGON_OPTIONS, hashToken } from './auth.service.js';
import { tokensRepository, type TokenFailure } from './tokens.repository.js';

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 30 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;

const newToken = () => randomBytes(32).toString('base64url'); // 256 bits de entropía

const failureMessage: Record<TokenFailure, [string, string]> = {
  invalid: ['token_invalid', 'El enlace no es válido'],
  used: ['token_used', 'Este enlace ya fue utilizado'],
  expired: ['token_expired', 'El enlace ha vencido'],
};
const tokenError = (r: TokenFailure) => new HttpError(400, failureMessage[r][1], failureMessage[r][0]);

export function createCredentialsService(mailer: Mailer) {
  async function sendVerification(user: { id: string; email: string; display_name: string }, ip?: string) {
    const token = newToken();
    await tokensRepository.issue(user.id, 'verify_email', hashToken(token), new Date(Date.now() + VERIFY_TTL_MS), ip);
    return trySend(mailer, verifyEmailMail(user.email, user.display_name, token));
  }

  return {
    sendVerification,

    async resendVerification(userId: string, ip?: string) {
      const user = await authRepository.findById(userId);
      if (!user) throw new HttpError(401, 'Necesitas iniciar sesión', 'unauthorized');
      if (user.email_verified) throw new HttpError(409, 'Tu correo ya está verificado', 'already_verified');
      const last = await tokensRepository.lastIssuedAt(userId, 'verify_email');
      const wait = last ? RESEND_COOLDOWN_MS - (Date.now() - last.getTime()) : 0;
      if (wait > 0) throw new HttpError(429, `Espera ${Math.ceil(wait / 1000)} s antes de pedir otro correo`, 'resend_cooldown');
      const sent = await sendVerification(user, ip);
      await authRepository.audit(userId, 'auth.verification_resent', ip);
      if (!sent) throw new HttpError(503, 'No pudimos enviar el correo, inténtalo de nuevo', 'mail_unavailable');
    },

    async verifyEmail(token: string, ip?: string) {
      const r = await tokensRepository.verifyEmail(hashToken(token));
      if (!r.ok) {
        await authRepository.audit(null, 'auth.verify_email_failed', ip, { reason: r.reason });
        throw tokenError(r.reason);
      }
      await authRepository.audit(r.userId, 'auth.email_verified', ip);
    },

    /** Respuesta siempre idéntica exista o no la cuenta (anti-enumeración). */
    async requestReset(email: string, ip?: string) {
      const user = await authRepository.findByIdentifier(email);
      if (!user || user.email !== email) return;
      const last = await tokensRepository.lastIssuedAt(user.id, 'reset_password');
      if (last && Date.now() - last.getTime() < RESEND_COOLDOWN_MS) return; // cooldown silencioso
      const token = newToken();
      await tokensRepository.issue(user.id, 'reset_password', hashToken(token), new Date(Date.now() + RESET_TTL_MS), ip);
      await authRepository.audit(user.id, 'auth.password_reset_requested', ip);
      await trySend(mailer, resetPasswordMail(user.email, token));
    },

    async validateReset(token: string) {
      const s = await tokensRepository.resetStatus(hashToken(token));
      if (s !== 'ok') throw tokenError(s);
    },

    async resetPassword(token: string, newPassword: string, ip?: string) {
      const passwordHash = await argon2.hash(newPassword, ARGON_OPTIONS);
      const r = await tokensRepository.resetPassword(hashToken(token), passwordHash);
      if (!r.ok) {
        await authRepository.audit(null, 'auth.password_reset_failed', ip, { reason: r.reason });
        throw tokenError(r.reason);
      }
      await authRepository.audit(r.userId, 'auth.password_reset_done', ip, { sessionsRevoked: true });
    },
  };
}
export type CredentialsService = ReturnType<typeof createCredentialsService>;
