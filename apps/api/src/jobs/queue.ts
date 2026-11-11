import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Cola de procesamiento de fotografías sobre PostgreSQL (pg-boss): no añade servicios (sin Redis), reutiliza la
 * base de datos existente y da reintentos con backoff exponencial, expiración de trabajos activos (recuperación
 * ante caída del worker) y encolado idempotente (política `exclusive` + `singletonKey` = id de la fotografía).
 */
export interface PhotoQueue {
  /** Encola el procesamiento de una fotografía. Idempotente: si ya hay un trabajo en cola o activo no duplica. */
  enqueue(photoId: string): Promise<void>;
  stop(): Promise<void>;
}

export interface QueueTuning {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  superviseIntervalSeconds?: number;
}

export const DEFAULT_TUNING: QueueTuning = { retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 300 };

export const newBoss = (tuning: Partial<QueueTuning> = {}) => {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, max: 4, ...(tuning.superviseIntervalSeconds ? { superviseIntervalSeconds: tuning.superviseIntervalSeconds, monitorIntervalSeconds: tuning.superviseIntervalSeconds } : {}) });
  boss.on('error', (err) => logger.error({ err: err.message }, 'Error de pg-boss'));
  return boss;
};

/** Crea la cola si no existe y sincroniza sus opciones (la versión desplegada manda). */
export async function ensureQueue(boss: PgBoss, tuning: Partial<QueueTuning> = {}) {
  const t = { ...DEFAULT_TUNING, ...tuning };
  const options = { retryLimit: t.retryLimit, retryDelay: t.retryDelay, retryBackoff: t.retryBackoff, expireInSeconds: t.expireInSeconds, deleteAfterSeconds: 86_400, retentionSeconds: 7 * 86_400 };
  if (!(await boss.getQueue(env.PHOTO_QUEUE))) await boss.createQueue(env.PHOTO_QUEUE, { policy: 'exclusive', ...options }); // la política no puede cambiar después
  else await boss.updateQueue(env.PHOTO_QUEUE, options);
}

class PgBossQueue implements PhotoQueue {
  private ready?: Promise<PgBoss>;
  private boss = newBoss();
  private start() {
    return (this.ready ??= (async () => {
      await this.boss.start();
      await ensureQueue(this.boss);
      return this.boss;
    })());
  }
  async enqueue(photoId: string) {
    const boss = await this.start();
    // null = ya existe un trabajo en cola/activo para esta fotografía (idempotente)
    await boss.send(env.PHOTO_QUEUE, { photoId }, { singletonKey: photoId });
  }
  async stop() {
    if (this.ready) await this.boss.stop({ graceful: true, timeout: 5000 });
  }
}

let instance: PhotoQueue | undefined;
export const getQueue = (): PhotoQueue => (instance ??= new PgBossQueue());
