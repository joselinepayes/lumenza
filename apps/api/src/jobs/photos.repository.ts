import { pool } from '../db/pool.js';
import { publish } from '../events/hub.js';
import type { VariantKind } from '../images/transforms.js';

export interface PhotoJobRow {
  id: string;
  post_id: string;
  author_id: string;
  bucket: string;
  storage_key: string;
  mime: string;
  status: string;
  sanitized: boolean;
}

/** Operaciones de base de datos del pipeline de procesamiento (separadas de la lógica de Sharp y del almacenamiento). */
export const photosJobs = {
  async load(photoId: string): Promise<PhotoJobRow | undefined> {
    return (await pool.query<PhotoJobRow>(
      `SELECT ph.id, ph.post_id, p.author_id, ph.bucket, ph.storage_key, ph.mime, ph.status, ph.sanitized
       FROM photos ph JOIN posts p ON p.id = ph.post_id WHERE ph.id = $1`, [photoId])).rows[0];
  },
  async exists(photoId: string): Promise<boolean> {
    return ((await pool.query('SELECT 1 FROM photos WHERE id = $1', [photoId])).rowCount ?? 0) > 0;
  },
  async start(photoId: string) {
    await pool.query(
      `UPDATE photos SET status = 'processing', attempts = attempts + 1, processing_started_at = COALESCE(processing_started_at, now()),
         processing_finished_at = NULL, updated_at = now() WHERE id = $1`, [photoId]);
  },
  async progress(photoId: string, progress: number, stage: string) {
    await pool.query('UPDATE photos SET progress = $2, stage = $3, updated_at = now() WHERE id = $1', [photoId, progress, stage]);
  },
  async sanitized(photoId: string, m: { mime: string; width: number; height: number; bytes: number; sha256: string }) {
    await pool.query('UPDATE photos SET mime = $2, width = $3, height = $4, bytes = $5, sha256 = $6, sanitized = true, updated_at = now() WHERE id = $1', [photoId, m.mime, m.width, m.height, m.bytes, m.sha256]);
  },
  async variantKinds(photoId: string): Promise<Set<string>> {
    return new Set((await pool.query<{ kind: string }>('SELECT kind::text AS kind FROM photo_variants WHERE photo_id = $1', [photoId])).rows.map((r) => r.kind));
  },
  /** Devuelve false si la fotografía fue eliminada mientras se procesaba (la FK falla). */
  async upsertVariant(photoId: string, v: { kind: VariantKind; bucket: string; key: string; width: number; height: number; bytes: number; params: object }): Promise<boolean> {
    try {
      await pool.query(
        `INSERT INTO photo_variants(photo_id, kind, bucket, storage_key, mime, width, height, bytes, params)
         VALUES ($1,$2::variant_kind,$3,$4,'image/webp',$5,$6,$7,$8)
         ON CONFLICT (photo_id, kind) DO UPDATE SET bucket = EXCLUDED.bucket, storage_key = EXCLUDED.storage_key, width = EXCLUDED.width, height = EXCLUDED.height, bytes = EXCLUDED.bytes, params = EXCLUDED.params`,
        [photoId, v.kind, v.bucket, v.key, v.width, v.height, v.bytes, JSON.stringify(v.params)]);
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === '23503') return false;
      throw e;
    }
  },
  async finish(photoId: string, workerId: string) {
    await pool.query(
      `UPDATE photos SET status = 'ready', progress = 100, stage = 'ready', last_error = NULL, processing_finished_at = now(), processed_by = $2, updated_at = now() WHERE id = $1`, [photoId, workerId]);
    // Tiempo real: la publicación ya es visible para su audiencia (el worker es otro proceso: se avisa por PostgreSQL)
    const post = (await pool.query<{ id: string; author_id: string; username: string; visibility: 'public' | 'followers' | 'private' }>(
      `SELECT p.id, p.author_id, u.username::text AS username, p.visibility::text AS visibility FROM photos ph JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id WHERE ph.id = $1`, [photoId])).rows[0];
    if (post) await publish({ kind: 'post', action: 'created', postId: post.id, authorId: post.author_id, authorUsername: post.username, visibility: post.visibility });
  },
  async recordError(photoId: string, message: string) {
    await pool.query('UPDATE photos SET last_error = $2, updated_at = now() WHERE id = $1', [photoId, message.slice(0, 500)]);
  },
  /** Estado final tras agotar reintentos: «partial» si ya existen display y miniatura, si no «failed». */
  async fail(photoId: string, message: string, workerId: string) {
    await pool.query(
      `UPDATE photos SET last_error = $2, processing_finished_at = now(), processed_by = $3, updated_at = now(),
         status = CASE WHEN (SELECT count(*) FROM photo_variants WHERE photo_id = $1 AND kind IN ('display','thumbnail')) = 2 THEN 'partial'::processing_status ELSE 'failed'::processing_status END,
         stage = 'failed' WHERE id = $1`, [photoId, message.slice(0, 500), workerId]);
  },
  async facesPending(photoId: string): Promise<boolean> {
    return ((await pool.query("SELECT 1 FROM photos WHERE id = $1 AND faces_status <> 'done'", [photoId])).rowCount ?? 0) > 0;
  },
  /** Guarda SOLO recuadros normalizados (sin landmarks, plantillas ni recortes). */
  async saveFaces(photoId: string, boxes: { x: number; y: number; w: number; h: number; score: number }[], model: string) {
    await pool.query("UPDATE photos SET faces = $2::jsonb, faces_status = 'done', faces_model = $3, faces_analyzed_at = now(), updated_at = now() WHERE id = $1", [photoId, JSON.stringify(boxes), model]);
  },
  async facesFailed(photoId: string) {
    await pool.query("UPDATE photos SET faces_status = 'failed', faces_analyzed_at = now(), updated_at = now() WHERE id = $1", [photoId]);
  },
  async requestFacesAgain(photoId: string) {
    await pool.query("UPDATE photos SET faces_status = 'pending', faces = '[]'::jsonb, faces_model = NULL, updated_at = now() WHERE id = $1", [photoId]);
  },
  /** Fotografías listas cuyo análisis de rostros está pendiente (p. ej. anteriores a la Fase 5). */
  async needingFaces(): Promise<string[]> {
    return (await pool.query<{ id: string }>("SELECT id FROM photos WHERE status = 'ready' AND faces_status = 'pending' ORDER BY updated_at LIMIT 100")).rows.map((r) => r.id);
  },
  async resetForRetry(photoId: string) {
    await pool.query(`UPDATE photos SET status = 'pending', progress = 0, stage = 'queued', last_error = NULL, attempts = 0, processing_finished_at = NULL, faces_status = 'pending', updated_at = now() WHERE id = $1`, [photoId]);
  },
  /** Fotografías atascadas (worker caído, trabajo perdido): candidatas a re-encolar. */
  async stuck(olderThanMinutes: number): Promise<string[]> {
    return (await pool.query<{ id: string }>(
      `SELECT id FROM photos WHERE status IN ('pending','processing') AND updated_at < now() - make_interval(mins => $1) LIMIT 50`, [olderThanMinutes])).rows.map((r) => r.id);
  },
  /** Fotografías antiguas (Fase 3) sin las tres transformaciones. */
  async needingTransforms(): Promise<string[]> {
    return (await pool.query<{ id: string }>(
      `SELECT ph.id FROM photos ph WHERE ph.status = 'ready' AND (SELECT count(*) FROM photo_variants v WHERE v.photo_id = ph.id AND v.kind IN ('bw_editorial','sepia_cinema','lumen_tone')) < 3 LIMIT 200`)).rows.map((r) => r.id);
  },
};
