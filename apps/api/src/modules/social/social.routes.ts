import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { publish } from '../../events/hub.js';
import { logger } from '../../lib/logger.js';
import { MAX_UPLOAD_BYTES, processAvatar, validateUpload } from '../../lib/images.js';
import { allObjectKeys, originalKey } from '../../jobs/photo-keys.js';
import { photosJobs } from '../../jobs/photos.repository.js';
import { getQueue, type PhotoQueue } from '../../jobs/queue.js';
import { makeLimiter } from '../../lib/limiter.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../middleware/errors.js';
import { getStorage, StorageError } from '../../storage/index.js';
import { usernameSchema } from '../auth/auth.schema.js';
import { CATEGORIES } from './dto.js';
import { postsRepository } from './posts.repository.js';
import { socialRepository } from './social.repository.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } });

const createSchema = z.object({
  caption: z.string().trim().max(2200).default(''),
  category: z.enum(CATEGORIES).optional().or(z.literal('').transform(() => undefined)),
  visibility: z.enum(['public', 'followers', 'private']).default('public'),
  allowDownload: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  tags: z.string().max(600).default(''),
});

const uuid = z.string().uuid();
const q = z.string().trim().min(1).max(60);

/** Normaliza etiquetas: minúsculas, sin acentos, [a-z0-9_], máx. 10; también extrae #etiquetas del texto. */
export function parseTags(tags: string, caption: string): string[] {
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
  const all = [...tags.split(/[\s,]+/), ...(caption.match(/#[\p{L}\p{N}_]+/gu) ?? [])].map(norm).filter((t) => t.length >= 1 && t.length <= 50);
  return [...new Set(all)].slice(0, 10);
}

const cursorOf = (req: Request) => (typeof req.query.cursor === 'string' ? req.query.cursor : undefined);
const param = (req: Request, name: string) => String(req.params[name]);

export function createSocialRouter(opts: { strictLimits?: boolean; queue?: PhotoQueue } = {}) {
  const queue = () => opts.queue ?? getQueue();
  const r = Router();
  // Solo rutas propias: las desconocidas siguen respondiendo 404 (no 401).
  r.use(['/media', '/posts', '/feed', '/explore', '/me', '/search', '/suggestions', '/users', '/comments', '/notifications'], requireAuth);
  const storage = () => getStorage();
  const uid = (req: Request) => req.user!.id;
  const strict = opts.strictLimits ?? false;

  // ---------- Media (acceso controlado por visibilidad) ----------
  r.get('/media/photo/:id/:variant', async (req, res) => {
    const id = uuid.safeParse(req.params.id);
    const variant = z.enum(['original', 'display', 'thumbnail', 'bw_editorial', 'sepia_cinema', 'lumen_tone']).safeParse(req.params.variant);
    if (!id.success || !variant.success) throw new HttpError(404, 'Recurso no encontrado', 'not_found');
    const loc = await postsRepository.mediaLocation(uid(req), id.data, variant.data);
    if (!loc) throw new HttpError(404, 'Recurso no encontrado', 'not_found');
    const download = req.query.download === '1';
    // El original a máxima resolución solo lo ve/descarga el autor o quien tenga permiso explícito
    if (variant.data === 'original' && !(loc.isOwner || loc.allowDownload)) throw new HttpError(404, 'Recurso no encontrado', 'not_found');
    if (download && !(loc.isOwner || loc.allowDownload)) throw new HttpError(403, 'La descarga no está permitida para esta fotografía', 'download_forbidden');
    try {
      const obj = await storage().get(loc.key);
      res.setHeader('Content-Type', loc.mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      if (download) res.setHeader('Content-Disposition', `attachment; filename="lumenza-${variant.data}-${id.data.slice(0, 8)}.${loc.mime.split('/')[1]}"`);
      res.send(obj.body);
    } catch (e) {
      if (e instanceof StorageError && e.code === 'not_found') throw new HttpError(404, 'Recurso no encontrado', 'not_found');
      throw new HttpError(502, 'Almacenamiento no disponible', 'storage_unavailable');
    }
  });

  r.get('/media/avatar/:userId', async (req, res) => {
    const id = uuid.safeParse(req.params.userId);
    const key = id.success ? await socialRepository.avatarKey(id.data) : undefined;
    if (!key) throw new HttpError(404, 'Recurso no encontrado', 'not_found');
    try {
      const obj = await storage().get(key);
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.send(obj.body);
    } catch {
      throw new HttpError(404, 'Recurso no encontrado', 'not_found');
    }
  });

  // ---------- Publicaciones ----------
  // Recepción rápida: valida cabecera, guarda el original, registra «pending» y encola. El procesamiento pesado lo hace el worker.
  r.post('/posts', makeLimiter(30, 60 * 60_000, strict), upload.single('photo'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Selecciona una fotografía', 'file_required');
    const f = createSchema.parse(req.body);
    const info = await validateUpload(req.file.buffer);
    const postId = randomUUID();
    const photoId = randomUUID();
    const key = originalKey(uid(req), postId, info.ext);
    try {
      await storage().put(key, req.file.buffer, info.mime);
    } catch {
      throw new HttpError(502, 'No se pudo guardar la imagen, inténtalo de nuevo', 'storage_unavailable');
    }
    const undo = () => Promise.allSettled(allObjectKeys(uid(req), postId).map((k) => storage().delete(k)));
    try {
      await postsRepository.create({
        id: postId, authorId: uid(req), caption: f.caption, category: f.category ?? null, visibility: f.visibility, allowDownload: f.allowDownload, tags: parseTags(f.tags, f.caption),
        photo: { id: photoId, bucket: storage().bucket, provider: 's3', region: env.S3_REGION, key, mime: info.mime, width: info.width, height: info.height, bytes: req.file.size, sha256: createHash('sha256').update(req.file.buffer).digest('hex') },
      });
    } catch (e) {
      await undo();
      throw e;
    }
    try {
      await queue().enqueue(photoId);
    } catch (e) {
      logger.error({ err: (e as Error).message }, 'No se pudo encolar el procesamiento');
      // Sin cola no hay procesamiento: se revierte todo para no dejar publicaciones fantasma.
      await postsRepository.deleteOwned(uid(req), postId);
      await undo();
      throw new HttpError(503, 'El procesamiento de imágenes no está disponible, inténtalo en unos minutos', 'queue_unavailable');
    }
    res.status(202).json({ post: await postsRepository.getById(uid(req), postId) });
  });

  // Reintento manual (solo el autor) de una fotografía fallida o parcial
  r.post('/posts/:id/reprocess', makeLimiter(20, 60 * 60_000, strict), async (req, res) => {
    const postId = uuid.parse(req.params.id);
    const photo = await postsRepository.ownedPhoto(uid(req), postId);
    if (!photo) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    if (!['failed', 'partial'].includes(photo.status)) throw new HttpError(409, 'La fotografía no necesita reprocesarse', 'not_reprocessable');
    await photosJobs.resetForRetry(photo.photoId);
    try {
      await queue().enqueue(photo.photoId);
    } catch {
      throw new HttpError(503, 'El procesamiento de imágenes no está disponible', 'queue_unavailable');
    }
    res.status(202).json({ post: await postsRepository.getById(uid(req), postId) });
  });

  // Repetir solo el análisis de rostros (autor). No cambia el estado visible de la fotografía.
  r.post('/posts/:id/faces/reanalyze', makeLimiter(20, 60 * 60_000, strict), async (req, res) => {
    const postId = uuid.parse(req.params.id);
    const photo = await postsRepository.ownedPhoto(uid(req), postId);
    if (!photo) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    if (photo.status !== 'ready' && photo.status !== 'partial') throw new HttpError(409, 'La fotografía aún se está procesando', 'still_processing');
    await photosJobs.requestFacesAgain(photo.photoId);
    try {
      await queue().enqueue(photo.photoId);
    } catch {
      throw new HttpError(503, 'El procesamiento de imágenes no está disponible', 'queue_unavailable');
    }
    res.status(202).json({ post: await postsRepository.getById(uid(req), postId) });
  });

  r.get('/posts/:id', async (req, res) => {
    const post = await postsRepository.getById(uid(req), uuid.parse(req.params.id));
    if (!post) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    res.json({ post });
  });

  const editSchema = z.object({
    caption: z.string().trim().max(2200).optional(),
    category: z.enum(CATEGORIES).nullable().optional(),
    visibility: z.enum(['public', 'followers', 'private']).optional(),
    allowDownload: z.boolean().optional(),
    tags: z.string().max(600).optional(),
    coverVariant: z.enum(['bw_editorial', 'sepia_cinema', 'lumen_tone']).nullable().optional(),
  });
  r.patch('/posts/:id', makeLimiter(120, 60 * 60_000, strict), async (req, res) => {
    const postId = uuid.parse(req.params.id);
    const f = editSchema.parse(req.body);
    const current = await postsRepository.getById(uid(req), postId);
    if (!current || !current.isOwner) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    if (f.coverVariant && !current.variants.some((v) => v.kind === f.coverVariant)) throw new HttpError(409, 'Esa versión aún no está disponible', 'variant_unavailable');
    const caption = f.caption ?? current.caption;
    const ok = await postsRepository.update(uid(req), postId, {
      caption: f.caption, category: f.category, visibility: f.visibility, allowDownload: f.allowDownload, coverVariant: f.coverVariant,
      tags: f.tags !== undefined || f.caption !== undefined ? parseTags(f.tags ?? current.tags.join(' '), caption) : undefined,
    });
    if (!ok) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    const post = (await postsRepository.getById(uid(req), postId))!;
    await publish({ kind: 'post', action: 'updated', postId, authorId: uid(req), authorUsername: req.user!.username, visibility: post.visibility });
    res.json({ post });
  });

  r.delete('/posts/:id', async (req, res) => {
    const postId = uuid.parse(req.params.id);
    const info = await postsRepository.authorInfo(postId);
    const keys = await postsRepository.deleteOwned(uid(req), postId);
    if (!keys) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    // Claves de BD + deterministas (cubre trabajos en curso que escriban objetos tras la eliminación; el worker también limpia)
    const all = new Set([...keys.map((k) => k.key), ...allObjectKeys(uid(req), postId)]);
    await Promise.allSettled([...all].map((k) => storage().delete(k)));
    if (info) await publish({ kind: 'post', action: 'deleted', postId, authorId: info.authorId, authorUsername: info.username, visibility: info.visibility });
    res.status(204).end();
  });

  // ---------- Feed / explorar ----------
  r.get('/feed', async (req, res) => res.json(await postsRepository.feed(uid(req), cursorOf(req))));

  r.get('/explore', async (req, res) => {
    const f = z.object({ category: z.enum(CATEGORIES).optional(), tag: z.string().regex(/^[a-z0-9_]{1,50}$/i).optional(), q: q.optional() }).parse(req.query);
    res.json(await postsRepository.explore(uid(req), { ...f, tag: f.tag?.toLowerCase() }, cursorOf(req)));
  });
  r.get('/explore/trending-tags', async (_req, res) => res.json({ items: await postsRepository.trendingTags() }));
  r.get('/explore/featured', async (req, res) => res.json({ items: await postsRepository.featured(uid(req)) }));
  r.get('/me/saved', async (req, res) => res.json(await postsRepository.saved(uid(req), cursorOf(req))));

  // ---------- Interacciones ----------
  const interact = async (req: Request, post: string) => {
    const id = uuid.parse(post);
    if (!(await postsRepository.getById(uid(req), id))) throw new HttpError(404, 'Publicación no encontrada', 'not_found');
    return id;
  };
  const state = async (req: Request, id: string) => {
    const p = (await postsRepository.getById(uid(req), id))!;
    return { likeCount: p.likeCount, commentCount: p.commentCount, liked: p.liked, saved: p.saved };
  };

  r.post('/posts/:id/like', async (req, res) => {
    const id = await interact(req, param(req, 'id'));
    if (await socialRepository.like(uid(req), id)) {
      const owner = await socialRepository.postAuthor(id);
      if (owner) await socialRepository.notify(owner, uid(req), 'like', id);
    }
    res.json(await state(req, id));
  });
  r.delete('/posts/:id/like', async (req, res) => {
    const id = await interact(req, param(req, 'id'));
    await socialRepository.unlike(uid(req), id);
    res.json(await state(req, id));
  });
  r.post('/posts/:id/save', async (req, res) => {
    const id = await interact(req, param(req, 'id'));
    await socialRepository.save(uid(req), id);
    res.json(await state(req, id));
  });
  r.delete('/posts/:id/save', async (req, res) => {
    const id = await interact(req, param(req, 'id'));
    await socialRepository.unsave(uid(req), id);
    res.json(await state(req, id));
  });

  r.get('/posts/:id/comments', async (req, res) => {
    const id = await interact(req, param(req, 'id'));
    res.json(await socialRepository.comments(uid(req), id, cursorOf(req)));
  });
  r.post('/posts/:id/comments', makeLimiter(60, 10 * 60_000, strict), async (req, res) => {
    const id = await interact(req, param(req, 'id'));
    const { body } = z.object({ body: z.string().trim().min(1, 'Escribe un comentario').max(1000) }).parse(req.body);
    const commentId = await socialRepository.addComment(uid(req), id, body);
    const owner = await socialRepository.postAuthor(id);
    if (owner) await socialRepository.notify(owner, uid(req), 'comment', id);
    res.status(201).json({ comment: await socialRepository.commentById(uid(req), commentId), commentCount: (await socialRepository.counts(id)).comments });
  });
  r.delete('/comments/:id', async (req, res) => {
    if (!(await socialRepository.deleteComment(uid(req), uuid.parse(req.params.id)))) throw new HttpError(404, 'Comentario no encontrado', 'not_found');
    res.status(204).end();
  });

  // ---------- Usuarios y relaciones ----------
  r.get('/search/users', async (req, res) => res.json({ items: await socialRepository.searchUsers(uid(req), q.parse(req.query.q)) }));
  r.get('/search/hashtags', async (req, res) => res.json({ items: await socialRepository.searchHashtags(q.parse(req.query.q).replace(/^#/, '')) }));
  r.get('/suggestions', async (req, res) => res.json({ items: await socialRepository.suggestions(uid(req)) }));

  r.patch('/me/profile', async (req, res) => {
    const b = z.object({ displayName: z.string().trim().min(1, 'Ingresa tu nombre').max(60), bio: z.string().trim().max(300).default('') }).parse(req.body);
    await socialRepository.updateProfile(uid(req), b.displayName, b.bio);
    res.json({ profile: await socialRepository.profile(uid(req), req.user!.username) });
  });
  r.post('/me/avatar', makeLimiter(20, 60 * 60_000, strict), upload.single('avatar'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Selecciona una imagen', 'file_required');
    const buf = await processAvatar(req.file.buffer);
    const key = `avatars/${uid(req)}/${randomUUID()}.webp`;
    try {
      await storage().put(key, buf, 'image/webp');
    } catch {
      throw new HttpError(502, 'No se pudo guardar la imagen', 'storage_unavailable');
    }
    const old = await socialRepository.setAvatar(uid(req), key);
    if (old) await storage().delete(old).catch(() => undefined);
    res.json({ profile: await socialRepository.profile(uid(req), req.user!.username) });
  });

  const target = async (req: Request) => {
    const name = usernameSchema.parse(req.params.username);
    const id = await socialRepository.userIdByUsername(name);
    if (!id) throw new HttpError(404, 'Usuario no encontrado', 'not_found');
    return { id, name };
  };
  r.get('/users/:username', async (req, res) => {
    const { name } = await target(req);
    res.json({ profile: await socialRepository.profile(uid(req), name) });
  });
  /** Un perfil privado solo muestra publicaciones y listas a su dueño y a sus seguidores aceptados. */
  const canView = async (req: Request, id: string) => id === uid(req) || !(await socialRepository.isPrivate(id)) || (await socialRepository.isFollowing(uid(req), id));
  r.get('/users/:username/posts', async (req, res) => {
    const { id } = await target(req);
    if (!(await canView(req, id))) return res.json({ items: [], nextCursor: null, locked: true });
    res.json(await postsRepository.byAuthor(uid(req), id, cursorOf(req)));
  });
  for (const kind of ['followers', 'following'] as const) {
    r.get(`/users/:username/${kind}`, async (req, res) => {
      const { id } = await target(req);
      if (!(await canView(req, id))) return res.json({ items: [], locked: true });
      res.json({ items: await socialRepository.relations(uid(req), id, kind) });
    });
  }

  r.post('/users/:username/follow', async (req, res) => {
    const { id, name } = await target(req);
    if (id === uid(req)) throw new HttpError(400, 'No puedes seguirte a ti mismo', 'self_follow');
    if (await socialRepository.isFollowing(uid(req), id)) return res.json({ profile: await socialRepository.profile(uid(req), name) });
    if (await socialRepository.isPrivate(id)) {
      // Perfil privado: se envía una solicitud que su dueño debe aceptar
      if (await socialRepository.requestFollow(uid(req), id)) await socialRepository.notify(id, uid(req), 'follow_request');
    } else if (await socialRepository.follow(uid(req), id)) await socialRepository.notify(id, uid(req), 'follow');
    res.json({ profile: await socialRepository.profile(uid(req), name) });
  });
  r.delete('/users/:username/follow', async (req, res) => {
    const { id, name } = await target(req);
    await socialRepository.unfollow(uid(req), id);
    res.json({ profile: await socialRepository.profile(uid(req), name) });
  });

  // ---------- Ajustes de privacidad y avisos ----------
  r.get('/me/settings', async (req, res) => res.json(await socialRepository.getSettings(uid(req))));
  r.patch('/me/settings', async (req, res) => {
    const b = z.object({
      isPrivate: z.boolean().optional(),
      notifPrefs: z.object({ follow: z.boolean(), like: z.boolean(), comment: z.boolean(), follow_request: z.boolean() }).partial().optional(),
    }).strict().parse(req.body);
    await socialRepository.updateSettings(uid(req), b);
    res.json(await socialRepository.getSettings(uid(req)));
  });

  // ---------- Solicitudes de seguimiento (perfil privado) ----------
  r.get('/me/follow-requests', async (req, res) => res.json({ items: await socialRepository.pendingRequests(uid(req)) }));
  for (const action of ['accept', 'decline'] as const) {
    r.post(`/me/follow-requests/:username/${action}`, async (req, res) => {
      const { id } = await target(req);
      if (!(await socialRepository.resolveRequest(uid(req), id, action === 'accept'))) throw new HttpError(404, 'Solicitud no encontrada', 'not_found');
      res.json({ ok: true, ...(await socialRepository.getSettings(uid(req))) });
    });
  }

  // ---------- Notificaciones ----------
  r.get('/notifications', async (req, res) => res.json(await socialRepository.notifications(uid(req), cursorOf(req))));
  r.get('/notifications/unread-count', async (req, res) => res.json({ count: await socialRepository.unreadCount(uid(req)) }));
  r.post('/notifications/read', async (req, res) => {
    const b = z.object({ ids: z.array(z.string().uuid()).max(100).optional() }).parse(req.body ?? {});
    await socialRepository.markRead(uid(req), b.ids);
    res.json({ count: await socialRepository.unreadCount(uid(req)) });
  });

  return r;
}
