import fs from 'node:fs/promises';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { startWorker } from './jobs/worker-core.js';

const HEARTBEAT = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/worker-heartbeat';
const worker = await startWorker();

// Latido para el healthcheck del contenedor: solo se escribe si la base de datos responde (el worker depende de ella).
const beat = async () => {
  try {
    await pool.query('SELECT 1');
    await fs.writeFile(HEARTBEAT, String(Date.now()));
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'Latido del worker no escrito');
  }
};
await beat();
const timer = setInterval(() => void beat(), 15_000);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Deteniendo worker (graceful)');
  clearInterval(timer);
  await worker.stop({ graceful: true }).catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
