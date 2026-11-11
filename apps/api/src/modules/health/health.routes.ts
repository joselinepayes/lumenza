import { Router } from 'express';
import { pingDb } from '../../db/pool.js';
import { getStorage } from '../../storage/index.js';

export const healthRouter = Router();

// Liveness: el proceso responde
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Readiness: dependencias disponibles
healthRouter.get('/ready', async (_req, res) => {
  const [db, storage] = await Promise.all([pingDb(), getStorage().ping()]);
  const ok = db && storage;
  res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', db, storage });
});
