import { createApp } from './app.js';
import { assertProductionConfig, env } from './config/env.js';
import { pool } from './db/pool.js';
import { startEventListener, stopEventListener } from './events/hub.js';
import { logger } from './lib/logger.js';

assertProductionConfig();
const server = createApp().listen(env.API_PORT, () => logger.info(`API LUMENZA en :${env.API_PORT}`));

startEventListener();

const shutdown = () => {
  void stopEventListener();
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
