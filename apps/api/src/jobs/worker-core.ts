import { hostname } from 'node:os';
import type { JobWithMetadata } from 'pg-boss';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { getStorage } from '../storage/index.js';
import type { StorageService } from '../storage/storage.service.js';
import { photosJobs } from './photos.repository.js';
import { processPhoto, type ProcessDeps } from './process-photo.js';
import { ensureQueue, newBoss, type QueueTuning } from './queue.js';

export interface WorkerOptions {
  storage?: StorageService;
  workerId?: string;
  concurrency?: number;
  tuning?: Partial<QueueTuning>;
  hooks?: ProcessDeps['hooks'];
  /** Detector de rostros (solo pruebas); por defecto face-api/WASM. */
  detector?: ProcessDeps['detector'];
  /** Sustituye el procesador (solo pruebas: simula un worker colgado/caído). */
  processor?: (photoId: string) => Promise<unknown>;
  sweepEverySeconds?: number;
  stuckAfterMinutes?: number;
}

export interface RunningWorker {
  id: string;
  stop(opts?: { graceful?: boolean }): Promise<void>;
}

/**
 * Worker de procesamiento: consume la cola, ejecuta el pipeline con Sharp y, en el último intento fallido,
 * deja la fotografía en «partial»/«failed». Un barrido periódico re-encola fotografías atascadas
 * (p. ej. trabajo perdido) y las fotografías antiguas sin transformaciones.
 */
export async function startWorker(o: WorkerOptions = {}): Promise<RunningWorker> {
  sharp.cache({ memory: 128, files: 0, items: 20 });
  sharp.concurrency(2); // limita hilos de libvips por proceso
  const storage = o.storage ?? getStorage();
  const id = o.workerId ?? `${hostname()}:${process.pid}`;
  const boss = newBoss(o.tuning);
  await boss.start();
  await ensureQueue(boss, o.tuning);

  await boss.work<{ photoId: string }>(env.PHOTO_QUEUE, { batchSize: 1, localConcurrency: o.concurrency ?? env.WORKER_CONCURRENCY, pollingIntervalSeconds: 1, includeMetadata: true }, async (jobs) => {
    const job = jobs[0] as JobWithMetadata<{ photoId: string }> | undefined;
    if (!job) return;
    const { photoId } = job.data;
    try {
      if (o.processor) await o.processor(photoId);
      else await processPhoto(photoId, { storage, workerId: id, hooks: o.hooks, detector: o.detector });
    } catch (e) {
      const msg = (e as Error).message ?? 'Error desconocido';
      logger.warn({ photoId, attempt: job.retryCount + 1, of: job.retryLimit + 1, err: msg }, 'Fallo al procesar fotografía');
      await photosJobs.recordError(photoId, msg).catch(() => undefined);
      if (job.retryCount >= job.retryLimit) await photosJobs.fail(photoId, msg, id).catch(() => undefined); // sin más reintentos
      throw e; // pg-boss reintenta con backoff (o marca el trabajo como fallido)
    }
  });

  const enqueueAll = async (ids: string[]) => {
    for (const photoId of ids) await boss.send(env.PHOTO_QUEUE, { photoId }, { singletonKey: photoId }).catch((e) => logger.warn({ err: (e as Error).message }, 'No se pudo re-encolar'));
  };
  const sweep = async () => {
    await enqueueAll(await photosJobs.stuck(o.stuckAfterMinutes ?? 10));
    await enqueueAll(await photosJobs.needingFaces()); // análisis de rostros pendiente (no cambia el estado visible)
    const old = await photosJobs.needingTransforms();
    if (old.length) { logger.info({ count: old.length }, 'Re-encolando fotografías sin transformaciones'); for (const p of old) await photosJobs.resetForRetry(p); await enqueueAll(old); }
  };
  await sweep().catch((e) => logger.warn({ err: (e as Error).message }, 'Barrido inicial fallido'));
  const timer = setInterval(() => sweep().catch(() => undefined), (o.sweepEverySeconds ?? 60) * 1000);
  logger.info({ workerId: id, queue: env.PHOTO_QUEUE }, 'Worker de fotografías iniciado');

  return {
    id,
    async stop(opts) {
      clearInterval(timer);
      await boss.stop({ graceful: opts?.graceful ?? true, timeout: 8000 });
    },
  };
}
