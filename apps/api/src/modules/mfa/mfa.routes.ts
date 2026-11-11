import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { cookieSecure, env } from '../../config/env.js';
import { makeLimiter } from '../../lib/limiter.js';
import { SESSION_COOKIE, requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { SESSION_TTL_MS, openSession, toPublic } from '../auth/auth.service.js';
import { mfaRepository } from './mfa.repository.js';
import { mfaService } from './mfa.service.js';

/** Cookie HttpOnly con el token del desafío de login (10 min). Solo se envía a /api/auth/mfa. */
export const MFA_COOKIE = 'lz_mfa';
export const setChallengeCookie = (res: Response, token: string, expiresAt: Date) =>
  res.cookie(MFA_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/api/auth/mfa', expires: expiresAt });

const code = z.string().trim().max(20);
const factor = z.object({ code: code.optional(), recoveryCode: code.optional() });
const reauthBody = z.object({ password: z.string().max(128).optional() });
const ctx = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });
const reauth = (req: Request, password?: string) => ({ password, sessionCreatedAt: req.user!.session_created_at });

export function createMfaRouter(opts: { strictLimits?: boolean } = {}) {
  const r = Router();
  const strict = opts.strictLimits ?? false;
  const sensitive = makeLimiter(10, 15 * 60_000, strict); // activar/desactivar/regenerar por IP
  const verifyLimit = makeLimiter(10, 15 * 60_000, strict); // segundo paso por IP

  // ---- Segundo paso del login (autenticado por la cookie del desafío, aún sin sesión) ----
  r.get('/challenge', async (req, res) => {
    const info = await mfaService.challengeInfo(req.cookies?.[MFA_COOKIE]);
    if (!info) throw new HttpError(401, 'La verificación expiró. Inicia sesión de nuevo', 'challenge_expired');
    res.json({ valid: true, ...info });
  });

  r.post('/verify', verifyLimit, async (req, res) => {
    const body = factor.parse(req.body);
    const out = await mfaService.completeChallenge(req.cookies?.[MFA_COOKIE], body, ctx(req));
    const session = await openSession(out.user, ctx(req), { mfaVerified: true });
    res.clearCookie(MFA_COOKIE, { path: '/api/auth/mfa' });
    res.cookie(SESSION_COOKIE, session.token, { httpOnly: true, sameSite: 'lax', secure: cookieSecure, path: '/', expires: session.expiresAt, maxAge: SESSION_TTL_MS });
    res.json({ user: toPublic(out.user), method: out.method, recoveryRemaining: out.recoveryRemaining });
  });

  // ---- Gestión desde Ajustes (sesión + autenticación reciente) ----
  r.get('/status', requireAuth, async (req, res) => res.json(await mfaService.status(req.user!)));

  r.post('/setup', requireAuth, sensitive, async (req, res) => {
    const { password } = reauthBody.parse(req.body);
    res.json(await mfaService.setup(req.user!, reauth(req, password), ctx(req)));
  });

  r.post('/enable', requireAuth, sensitive, async (req, res) => {
    const { code: c } = z.object({ code: code.min(6) }).parse(req.body);
    const recoveryCodes = await mfaService.enable(req.user!, c, ctx(req));
    // Otras sesiones se cierran; la actual pasa a «verificada» (y a alcance completo si era de enrolamiento de administrador)
    await mfaRepository.revokeOtherSessions(req.user!.id, req.sessionTokenHash ?? null);
    if (req.sessionTokenHash) await mfaRepository.promoteSession(req.sessionTokenHash);
    res.json({ recoveryCodes });
  });

  r.post('/disable', requireAuth, sensitive, async (req, res) => {
    const body = reauthBody.merge(factor).parse(req.body);
    await mfaService.disable(req.user!, reauth(req, body.password), body, ctx(req));
    await mfaRepository.revokeOtherSessions(req.user!.id, req.sessionTokenHash ?? null);
    res.status(204).end();
  });

  r.post('/recovery-codes/regenerate', requireAuth, sensitive, async (req, res) => {
    const body = reauthBody.merge(factor).parse(req.body);
    res.json({ recoveryCodes: await mfaService.regenerate(req.user!, reauth(req, body.password), body, ctx(req)) });
  });

  return r;
}
