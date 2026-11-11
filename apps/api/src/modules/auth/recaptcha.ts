import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/errors.js';

export const recaptchaEnabled = () => Boolean(env.RECAPTCHA_SECRET_KEY && env.RECAPTCHA_SITE_KEY);

/** Verificación REAL contra Google. Si no hay claves configuradas, no se exige (y /auth/config lo informa). */
export async function verifyRecaptcha(token: string | undefined, ip?: string): Promise<void> {
  if (!recaptchaEnabled()) return;
  if (!token) throw new HttpError(400, 'Completa la verificación reCAPTCHA', 'captcha_required');
  const body = new URLSearchParams({ secret: env.RECAPTCHA_SECRET_KEY!, response: token });
  if (ip) body.set('remoteip', ip);
  let ok = false;
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    ok = ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    throw new HttpError(503, 'No se pudo validar reCAPTCHA, inténtalo de nuevo', 'captcha_unavailable');
  }
  if (!ok) throw new HttpError(400, 'Verificación reCAPTCHA no válida', 'captcha_failed');
}
