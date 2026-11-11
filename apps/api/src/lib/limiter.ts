import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/errors.js';

/** Limitador por IP; en NODE_ENV=test se relaja salvo que se pida `strict`. */
export const makeLimiter = (max: number, windowMs: number, strict = false) =>
  rateLimit({
    windowMs,
    limit: env.NODE_ENV === 'test' && !strict ? 10_000 : max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'Demasiadas solicitudes, inténtalo más tarde', 'rate_limited')),
  });
