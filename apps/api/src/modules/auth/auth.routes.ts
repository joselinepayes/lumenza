import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { cookieSecure, env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getMailer, type Mailer } from '../../mail/mailer.js';
import type { PhotoQueue } from '../../jobs/queue.js';
import { SESSION_COOKIE, requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema, usernameSchema, verifyEmailSchema } from './auth.schema.js';
import { mfaService } from '../mfa/mfa.service.js';
import { setChallengeCookie } from '../mfa/mfa.routes.js';
import { SESSION_TTL_MS, authService, openSession, toPublic } from './auth.service.js';
import { createCredentialsService } from './credentials.service.js';
import { RealGoogleProvider, type GoogleProvider } from './google.js';
import { GoogleLoginError, resolveGoogleUser } from './google.service.js';
import { recaptchaEnabled, verifyRecaptcha } from './recaptcha.js';

export interface AuthDeps {
  mailer?: Mailer;
  google?: GoogleProvider;
  /** Cola de procesamiento de fotografías (por defecto pg-boss). */
  queue?: PhotoQueue;
  /** Fuerza los límites reales de producción (en NODE_ENV=test están relajados salvo que se pida lo contrario). */
  strictLimits?: boolean;
}

const OAUTH_COOKIE = 'lz_oauth';

export function createAuthRouter(deps: AuthDeps = {}) {
  const router = Router();
  const credentials = createCredentialsService(deps.mailer ?? getMailer());
  const google = deps.google ?? new RealGoogleProvider();

  const limiter = (max: number, windowMs: number) =>
    rateLimit({
      windowMs,
      limit: env.NODE_ENV === 'test' && !deps.strictLimits ? 10_000 : max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new HttpError(429, 'Demasiados intentos, inténtalo más tarde', 'rate_limited')),
    });

  const setSessionCookie = (res: Response, token: string, expiresAt: Date) =>
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/', expires: expiresAt, maxAge: SESSION_TTL_MS });
  const ctx = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

  router.get('/config', (_req, res) => {
    res.json({ recaptcha: recaptchaEnabled() ? { siteKey: env.RECAPTCHA_SITE_KEY } : null, google: google.enabled, mfa: mfaService.available() });
  });

  router.get('/username-available', limiter(60, 60_000), async (req, res) => {
    const parsed = usernameSchema.safeParse(req.query.u);
    if (!parsed.success) return void res.json({ available: false, reason: 'invalid' });
    res.json({ available: await authService.usernameAvailable(parsed.data) });
  });

  router.post('/register', limiter(10, 60 * 60_000), async (req, res) => {
    const input = registerSchema.parse(req.body);
    const { user, session } = await authService.register(input, ctx(req));
    setSessionCookie(res, session.token, session.expiresAt);
    // Correo de verificación; si falla, el usuario puede reenviarlo desde la app.
    await credentials.sendVerification({ id: user.id, email: user.email, display_name: user.displayName }, req.ip);
    res.status(201).json({ user });
  });

  router.post('/login', limiter(10, 15 * 60_000), async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await authService.login(input, ctx(req));
    const gate = await mfaService.gate(user);
    if (gate === 'mfa') {
      // Credenciales correctas pero NO se crea sesión: hace falta el segundo factor
      const ch = await mfaService.startChallenge(user, 'password', ctx(req));
      setChallengeCookie(res, ch.token, ch.expiresAt);
      return void res.json({ mfaRequired: true });
    }
    const session = await openSession(user, ctx(req), gate === 'admin_enroll' ? { scope: 'mfa_setup' } : {});
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user: toPublic(user), ...(gate === 'admin_enroll' ? { mfaEnrollmentRequired: true } : {}) });
  });

  router.post('/logout', async (req, res) => {
    await authService.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    const u = req.user!;
    res.json({ user: toPublic(u), sessionScope: u.session_scope ?? 'full' });
  });

  // --- Verificación de correo (POST: los escáneres de enlaces que hacen GET no consumen el token) ---
  router.post('/verify-email', limiter(20, 15 * 60_000), async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    await credentials.verifyEmail(token, req.ip);
    res.json({ verified: true });
  });

  router.post('/resend-verification', requireAuth, limiter(5, 60 * 60_000), async (req, res) => {
    await credentials.resendVerification(req.user!.id, req.ip);
    res.status(202).json({ sent: true });
  });

  // --- Recuperación de contraseña ---
  router.post('/forgot-password', limiter(5, 60 * 60_000), async (req, res) => {
    const { email, captchaToken } = forgotSchema.parse(req.body);
    await verifyRecaptcha(captchaToken, req.ip);
    await credentials.requestReset(email, req.ip);
    res.status(202).json({ message: 'Si existe una cuenta con ese correo, te enviamos instrucciones.' });
  });

  router.post('/reset-password/validate', limiter(30, 15 * 60_000), async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    await credentials.validateReset(token);
    res.json({ valid: true });
  });

  router.post('/reset-password', limiter(10, 15 * 60_000), async (req, res) => {
    const { token, password } = resetSchema.parse(req.body);
    await credentials.resetPassword(token, password, req.ip);
    res.json({ reset: true });
  });

  // --- Google OAuth 2.0 (Authorization Code + PKCE + state + nonce) ---
  const toLogin = (res: Response, error?: string) => res.redirect(`${env.WEB_ORIGIN}/login${error ? `?error=${error}` : ''}`);

  router.get('/google', limiter(30, 15 * 60_000), (_req, res) => {
    if (!google.enabled) return toLogin(res, 'google_not_configured');
    const s = google.start();
    res.cookie(OAUTH_COOKIE, { state: s.state, verifier: s.verifier, nonce: s.nonce }, {
      httpOnly: true, sameSite: 'lax', secure: cookieSecure, signed: true, maxAge: 10 * 60_000, path: '/api/auth/google',
    });
    res.redirect(s.url);
  });

  router.get('/google/callback', limiter(30, 15 * 60_000), async (req, res) => {
    const saved = req.signedCookies?.[OAUTH_COOKIE] as { state?: string; verifier?: string; nonce?: string } | undefined;
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth/google' });
    if (!google.enabled) return toLogin(res, 'google_not_configured');
    if (typeof req.query.error === 'string') return toLogin(res, req.query.error === 'access_denied' ? 'google_cancelled' : 'google_failed');
    const { code, state } = req.query;
    if (!saved?.state || typeof code !== 'string' || typeof state !== 'string' || state !== saved.state) return toLogin(res, 'google_state');
    try {
      const claims = await google.exchange(code, saved.verifier!, saved.nonce!);
      const user = await resolveGoogleUser(claims, req.ip);
      // Google NO puede saltarse el MFA de LUMENZA: si está activo se exige el segundo factor antes de abrir sesión
      const gate = await mfaService.gate(user);
      if (gate === 'mfa') {
        const ch = await mfaService.startChallenge(user, 'google', ctx(req));
        setChallengeCookie(res, ch.token, ch.expiresAt);
        return res.redirect(`${env.WEB_ORIGIN}/login/mfa`);
      }
      const session = await openSession(user, ctx(req), gate === 'admin_enroll' ? { scope: 'mfa_setup' } : {});
      setSessionCookie(res, session.token, session.expiresAt);
      res.redirect(`${env.WEB_ORIGIN}${gate === 'admin_enroll' ? '/ajustes/seguridad' : '/inicio'}`);
    } catch (e) {
      if (e instanceof GoogleLoginError) return toLogin(res, `google_${e.code}`);
      logger.warn({ err: (e as Error).message }, 'Fallo en el inicio de sesión con Google');
      toLogin(res, 'google_failed');
    }
  });

  return router;
}
