import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { csrfOriginCheck, enforceSessionScope, loadUser } from './middleware/auth.js';
import { createMfaRouter } from './modules/mfa/mfa.routes.js';
import { createAuthRouter, type AuthDeps } from './modules/auth/auth.routes.js';
import { createSocialRouter } from './modules/social/social.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { createEventsRouter } from './events/events.routes.js';

export function createApp(deps: AuthDeps = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: [env.WEB_ORIGIN], credentials: true }));
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser(env.SESSION_SECRET));
  // Límite global por IP. En NODE_ENV=test se relaja (igual que los limitadores de rutas) salvo que se pida `strictLimits`.
  app.use('/api', rateLimit({ windowMs: 60_000, limit: env.NODE_ENV === 'test' && !deps.strictLimits ? 10_000 : 300, standardHeaders: true, legacyHeaders: false }));

  app.use('/api', csrfOriginCheck);
  app.use('/api', loadUser);
  app.use('/api', enforceSessionScope);
  app.use('/api', healthRouter);
  app.use('/api', createEventsRouter());
  app.use('/api/auth/mfa', createMfaRouter({ strictLimits: deps.strictLimits }));
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api', createSocialRouter({ strictLimits: deps.strictLimits, queue: deps.queue }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
