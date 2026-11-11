import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { authService, hashToken } from '../modules/auth/auth.service.js';
import type { UserRow } from '../modules/auth/auth.repository.js';
import { HttpError } from './errors.js';

export const SESSION_COOKIE = 'lz_session';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRow;
    sessionTokenHash?: string;
  }
}

/** Carga el usuario de la sesión si existe (no exige autenticación). */
export const loadUser: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = await authService.userFromToken(token);
    if (req.user && token) req.sessionTokenHash = hashToken(token);
    next();
  } catch (e) {
    next(e);
  }
};

/** Sesiones con alcance `mfa_setup` (administradores sin MFA): solo pueden usar /api/auth/* para enrolar MFA o cerrar sesión. */
export const enforceSessionScope: RequestHandler = (req, _res, next) => {
  if (req.user?.session_scope === 'mfa_setup' && !req.originalUrl.startsWith('/api/auth/')) {
    return next(new HttpError(403, 'Debes activar la autenticación multifactor para continuar', 'mfa_enrollment_required'));
  }
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Necesitas iniciar sesión', 'unauthorized'));
  next();
};

/** Protección CSRF: las peticiones que modifican estado deben venir del origen del frontend (+ cookie SameSite=Lax). */
export const csrfOriginCheck: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin !== env.WEB_ORIGIN) return next(new HttpError(403, 'Origen no permitido', 'bad_origin'));
  next();
};
