import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { LIMITS, ALL_KINDS, makeVariant, toRaw, type VariantKind } from '../images/transforms.js';
import { logger } from '../lib/logger.js';
import type { StorageService } from '../storage/storage.service.js';
import { getFaceDetector, type FaceDetector } from '../faces/detector.js';
import { allObjectKeys, variantKey } from './photo-keys.js';
import { photosJobs } from './photos.repository.js';

/** Error que no mejora reintentando (imagen corrupta): se marca «failed» sin gastar reintentos. */
export class PermanentProcessingError extends Error {}

export type ProcessOutcome = 'ready' | 'gone' | 'permanent_failure';

export interface ProcessDeps {
  storage: StorageService;
  workerId: string;
  /** Detector de rostros (por defecto face-api sobre WASM); inyectable en pruebas. */
  detector?: FaceDetector;
  /** Punto de inyección para pruebas (pausas/fallos controlados); no se usa en producción. */
  hooks?: { beforeVariant?: (kind: VariantKind, photoId: string) => Promise<void> };
}

const STAGES: Record<VariantKind, { progress: number; label: string }> = {
  display: { progress: 30, label: 'display' },
  thumbnail: { progress: 42, label: 'thumbnail' },
  bw_editorial: { progress: 60, label: 'bw_editorial' },
  sepia_cinema: { progress: 78, label: 'sepia_cinema' },
  lumen_tone: { progress: 95, label: 'lumen_tone' },
};

/**
 * Pipeline completo e idempotente de una fotografía:
 *  1) valida y sanea el original (re-codifica sin EXIF/GPS, auto-orienta) — el original NUNCA recibe filtros;
 *  2) decodifica una vez a un raster de trabajo acotado;
 *  3) genera y guarda cada variante que falte (los reintentos reutilizan las ya hechas);
 *  4) si la publicación se eliminó durante el proceso, borra lo escrito y termina limpiamente.
 */
export async function processPhoto(photoId: string, deps: ProcessDeps): Promise<ProcessOutcome> {
  const { storage, workerId } = deps;
  const row = await photosJobs.load(photoId);
  if (!row) return 'gone';
  const cleanup = () => Promise.allSettled(allObjectKeys(row.author_id, row.post_id).map((k) => storage.delete(k)));

  // Solo falta el análisis de rostros (foto ya lista, p. ej. anterior a la Fase 5): no se altera el estado visible.
  if (row.status === 'ready' && row.sanitized && (await photosJobs.facesPending(photoId))) {
    const kinds = await photosJobs.variantKinds(photoId);
    if (ALL_KINDS.every((k) => kinds.has(k))) {
      await runFaces(photoId, row.storage_key, deps, storage);
      return 'ready';
    }
  }

  await photosJobs.start(photoId);
  await photosJobs.progress(photoId, 5, 'validating');

  // 1) Original: validar decodificación completa (falla con archivos truncados/corruptos) y sanear
  let original: Buffer;
  try {
    original = (await storage.get(row.storage_key)).body;
  } catch (e) {
    if ((e as { code?: string }).code === 'not_found') {
      if (!(await photosJobs.exists(photoId))) return 'gone';
      await photosJobs.fail(photoId, 'No se encontró el archivo original', workerId);
      return 'permanent_failure';
    }
    throw e; // almacenamiento no disponible → reintento
  }

  if (!row.sanitized) {
    try {
      const meta = await sharp(original, { limitInputPixels: LIMITS.maxInputPixels }).metadata();
      const format = meta.format === 'jpeg' || meta.format === 'png' || meta.format === 'webp' ? meta.format : null;
      if (!format) throw new PermanentProcessingError('Formato no admitido');
      const { data, info } = await sharp(original, { limitInputPixels: LIMITS.maxInputPixels, failOn: 'warning' })
        .rotate()
        .toFormat(format, format === 'jpeg' ? { quality: 92, mozjpeg: true } : {})
        .toBuffer({ resolveWithObject: true });
      const mime = `image/${format}`;
      await storage.put(row.storage_key, data, mime);
      await photosJobs.sanitized(photoId, { mime, width: info.width, height: info.height, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
      original = data;
    } catch (e) {
      if (e instanceof PermanentProcessingError || /corrupt|premature|truncated|unsupported image|bad seek|Input buffer|VipsJpeg|vips/i.test((e as Error).message)) {
        await photosJobs.fail(photoId, 'La imagen está dañada o no se puede decodificar', workerId);
        return 'permanent_failure';
      }
      throw e;
    }
  }
  await photosJobs.progress(photoId, 15, 'decoding');

  // 2) Raster de trabajo (una sola decodificación)
  let raw;
  try {
    raw = await toRaw(original);
  } catch (e) {
    if (/pixel limit|exceeds/i.test((e as Error).message)) {
      await photosJobs.fail(photoId, 'La imagen supera el límite de resolución', workerId);
      return 'permanent_failure';
    }
    throw e;
  }

  // 3) Variantes (las existentes se reutilizan)
  const done = await photosJobs.variantKinds(photoId);
  for (const kind of ALL_KINDS) {
    const key = variantKey(row.author_id, row.post_id, kind);
    if (done.has(kind) && (await storage.exists(key))) continue;
    await deps.hooks?.beforeVariant?.(kind, photoId);
    if (!(await photosJobs.exists(photoId))) { await cleanup(); return 'gone'; }
    const v = await makeVariant(kind, raw);
    await storage.put(key, v.buffer, 'image/webp');
    const ok = await photosJobs.upsertVariant(photoId, { kind, bucket: storage.bucket, key, width: v.width, height: v.height, bytes: v.buffer.length, params: v.params });
    if (!ok) { await cleanup(); return 'gone'; } // eliminada entre la comprobación y la escritura
    await photosJobs.progress(photoId, STAGES[kind].progress, STAGES[kind].label);
  }

  // 4) Rostros (no bloquea: si falla, la fotografía queda lista y el análisis puede reintentarse)
  await photosJobs.progress(photoId, 98, 'faces');
  await analyzeFaces(photoId, raw, deps);

  // 5) Cierre
  if (!(await photosJobs.exists(photoId))) { await cleanup(); return 'gone'; }
  await photosJobs.finish(photoId, workerId);
  logger.info({ photoId, workerId }, 'Fotografía procesada');
  return 'ready';
}

/** Detecta rostros sobre el raster ya orientado y guarda únicamente recuadros normalizados. Nunca lanza. */
async function analyzeFaces(photoId: string, raw: Awaited<ReturnType<typeof toRaw>>, deps: ProcessDeps) {
  const detector = deps.detector ?? getFaceDetector();
  try {
    const boxes = await detector.detect(raw);
    await photosJobs.saveFaces(photoId, boxes, detector.model);
  } catch (e) {
    logger.warn({ photoId, err: (e as Error).message }, 'No se pudo analizar rostros (la fotografía sigue disponible)');
    await photosJobs.facesFailed(photoId).catch(() => undefined);
  }
}

async function runFaces(photoId: string, key: string, deps: ProcessDeps, storage: StorageService) {
  try {
    const original = (await storage.get(key)).body;
    await analyzeFaces(photoId, await toRaw(original), deps);
  } catch (e) {
    logger.warn({ photoId, err: (e as Error).message }, 'Análisis de rostros aplazado');
  }
}
