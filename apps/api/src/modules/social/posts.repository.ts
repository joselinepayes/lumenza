import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { avatarUrl, decodeCursor, encodeCursor, type Page, type PostDTO } from './dto.js';

const PAGE = 12;

interface Row {
  id: string; caption: string; category: string | null; visibility: PostDTO['visibility']; allow_download: boolean;
  created_at: Date; created_text: string; author_id: string; username: string; display_name: string; avatar_key: string | null;
  photo_id: string; width: number; height: number; obytes: string; omime: string; pstatus: PostDTO['processing']['status']; progress: number; stage: string | null; last_error: string | null; attempts: number; faces_status: 'pending' | 'done' | 'failed'; faces: { x: number; y: number; w: number; h: number; score: number }[]; variants: { kind: string; width: number; height: number; bytes: string; params: Record<string, unknown> }[]; like_count: number; comment_count: number; liked: boolean; saved: boolean; tags: string[]; edited_at: Date | null; cover_variant: string | null;
}

/** Predicado de visibilidad para el espectador ($1). */
export const VISIBLE = `(p.author_id = $1
  OR (p.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM profiles pv WHERE pv.user_id = p.author_id AND pv.is_private))
  OR (p.visibility IN ('public','followers') AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = p.author_id)))`;

const SELECT = `
SELECT p.id, p.caption, p.category, p.visibility, p.allow_download, p.edited_at, p.cover_variant, p.created_at, p.created_at::text AS created_text,
  u.id AS author_id, u.username::text AS username, pr.display_name, pr.avatar_key,
  ph.id AS photo_id, ph.width, ph.height, ph.bytes::text AS obytes, ph.mime AS omime, ph.status::text AS pstatus, ph.progress, ph.stage, ph.last_error, ph.attempts, ph.faces_status, ph.faces,
  (SELECT COALESCE(json_agg(json_build_object('kind', v.kind, 'width', v.width, 'height', v.height, 'bytes', v.bytes::text, 'params', v.params) ORDER BY v.created_at), '[]'::json) FROM photo_variants v WHERE v.photo_id = ph.id) AS variants,
  (SELECT count(*) FROM likes l WHERE l.post_id = p.id)::int AS like_count,
  (SELECT count(*) FROM comments c WHERE c.post_id = p.id)::int AS comment_count,
  EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked,
  EXISTS (SELECT 1 FROM saves s WHERE s.post_id = p.id AND s.user_id = $1) AS saved,
  ARRAY(SELECT h.tag::text FROM post_hashtags x JOIN hashtags h ON h.id = x.hashtag_id WHERE x.post_id = p.id ORDER BY h.tag) AS tags
FROM posts p
JOIN users u ON u.id = p.author_id AND u.deleted_at IS NULL
JOIN profiles pr ON pr.user_id = u.id
JOIN photos ph ON ph.post_id = p.id AND (ph.status IN ('ready','partial') OR p.author_id = $1)`;
const READY = `ph.status IN ('ready','partial')`;

export const toDTO = (r: Row, viewerId: string): PostDTO => ({
  id: r.id,
  caption: r.caption,
  category: r.category,
  visibility: r.visibility,
  allowDownload: r.allow_download,
  createdAt: r.created_at.toISOString(),
  author: { id: r.author_id, username: r.username, displayName: r.display_name, avatarUrl: avatarUrl(r.author_id, r.avatar_key) },
  photo: { id: r.photo_id, width: r.width, height: r.height, bytes: Number(r.obytes), mime: r.omime, displayUrl: `/api/media/photo/${r.photo_id}/${r.cover_variant && r.variants.some((v) => v.kind === r.cover_variant) ? r.cover_variant : 'display'}`, thumbUrl: `/api/media/photo/${r.photo_id}/thumbnail` },
  processing: { status: r.pstatus, progress: r.progress, stage: r.stage, error: r.pstatus === 'failed' || r.pstatus === 'partial' ? r.last_error : null, attempts: r.attempts },
  faces: { status: r.faces_status, count: r.faces_status === 'done' ? r.faces.length : 0, boxes: r.faces_status === 'done' ? r.faces : [] },
  variants: r.variants.map((v) => ({ kind: v.kind, url: `/api/media/photo/${r.photo_id}/${v.kind}`, width: v.width, height: v.height, bytes: Number(v.bytes), params: v.params })),
  tags: r.tags,
  editedAt: r.edited_at ? r.edited_at.toISOString() : null,
  coverVariant: r.cover_variant,
  likeCount: r.like_count,
  commentCount: r.comment_count,
  liked: r.liked,
  saved: r.saved,
  isOwner: r.author_id === viewerId,
});

/** Lista paginada por cursor. `where` usa $1 = espectador y los parámetros extra empiezan en $2. */
async function list(viewerId: string, where: string, params: unknown[], cursor?: string, orderBy = 'p.created_at DESC, p.id DESC', join = ''): Promise<Page<PostDTO>> {
  const c = decodeCursor(cursor);
  const args: unknown[] = [viewerId, ...params];
  let cur = '';
  if (c) {
    args.push(c.at, c.id);
    cur = ` AND (p.created_at, p.id) < ($${args.length - 1}::timestamptz, $${args.length}::uuid)`;
  }
  const sql = `${SELECT} ${join} WHERE ${VISIBLE} AND (${where})${cur} ORDER BY ${orderBy} LIMIT ${PAGE + 1}`;
  const rows = (await pool.query<Row>(sql, args)).rows;
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const last = page[page.length - 1];
  return { items: page.map((r) => toDTO(r, viewerId)), nextCursor: more && last ? encodeCursor(last.created_text, last.id) : null };
}

export const postsRepository = {
  async getById(viewerId: string, id: string): Promise<PostDTO | undefined> {
    const rows = (await pool.query<Row>(`${SELECT} WHERE p.id = $2 AND ${VISIBLE}`, [viewerId, id])).rows;
    return rows[0] ? toDTO(rows[0], viewerId) : undefined;
  },

  feed: (viewerId: string, cursor?: string) =>
    list(viewerId, `p.author_id = $1 OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $1)`, [], cursor),

  explore(viewerId: string, o: { category?: string; tag?: string; q?: string }, cursor?: string) {
    const parts = [`p.visibility = 'public'`, READY];
    const params: unknown[] = [];
    if (o.category) { params.push(o.category); parts.push(`p.category = $${params.length + 1}::post_category`); }
    if (o.tag) { params.push(o.tag); parts.push(`EXISTS (SELECT 1 FROM post_hashtags x JOIN hashtags h ON h.id = x.hashtag_id WHERE x.post_id = p.id AND h.tag = $${params.length + 1})`); }
    if (o.q) { params.push(`%${o.q.replace(/[%_\\]/g, '\\$&')}%`); parts.push(`(p.caption ILIKE $${params.length + 1} OR EXISTS (SELECT 1 FROM post_hashtags x JOIN hashtags h ON h.id = x.hashtag_id WHERE x.post_id = p.id AND h.tag::text ILIKE $${params.length + 1}))`); }
    return list(viewerId, parts.join(' AND '), params, cursor);
  },

  byAuthor: (viewerId: string, authorId: string, cursor?: string) => list(viewerId, `p.author_id = $2`, [authorId], cursor),

  saved: (viewerId: string, cursor?: string) => list(viewerId, `EXISTS (SELECT 1 FROM saves s WHERE s.post_id = p.id AND s.user_id = $1)`, [], cursor),

  /** Destacadas: más likes en los últimos 30 días (solo públicas). */
  async featured(viewerId: string): Promise<PostDTO[]> {
    const rows = (await pool.query<Row>(
      `${SELECT} WHERE p.visibility = 'public' AND ${READY} AND p.created_at > now() - interval '30 days' AND ${VISIBLE}
       ORDER BY (SELECT count(*) FROM likes l WHERE l.post_id = p.id) DESC, p.created_at DESC LIMIT 6`, [viewerId])).rows;
    return rows.map((r) => toDTO(r, viewerId));
  },

  async create(input: {
    id: string; authorId: string; caption: string; category: string | null; visibility: string; allowDownload: boolean; tags: string[];
    photo: { id: string; bucket: string; provider: string; region?: string; key: string; mime: string; width: number; height: number; bytes: number; sha256: string };
  }) {
    const c: PoolClient = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO posts(id, author_id, caption, category, visibility, allow_download) VALUES ($1,$2,$3,$4,$5,$6)', [input.id, input.authorId, input.caption, input.category, input.visibility, input.allowDownload]);
      const p = input.photo;
      await c.query(
        `INSERT INTO photos(id, post_id, storage_provider, bucket, storage_key, region, mime, width, height, bytes, sha256, status, stage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending','queued')`,
        [p.id, input.id, p.provider, p.bucket, p.key, p.region ?? null, p.mime, p.width, p.height, p.bytes, p.sha256],
      );
      for (const tag of input.tags) {
        const h = await c.query<{ id: number }>('INSERT INTO hashtags(tag) VALUES ($1) ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag RETURNING id', [tag]);
        await c.query('INSERT INTO post_hashtags(post_id, hashtag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [input.id, h.rows[0]!.id]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  /** Edita una publicación propia. Devuelve false si no existe o no es del autor. */
  async update(authorId: string, postId: string, patch: { caption?: string; category?: string | null; visibility?: string; allowDownload?: boolean; coverVariant?: string | null; tags?: string[] }): Promise<boolean> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const sets: string[] = ['edited_at = now()'];
      const args: unknown[] = [postId, authorId];
      const add = (col: string, v: unknown, cast = '') => { args.push(v); sets.push(`${col} = $${args.length}${cast}`); };
      if (patch.caption !== undefined) add('caption', patch.caption);
      if (patch.category !== undefined) add('category', patch.category, '::post_category');
      if (patch.visibility !== undefined) add('visibility', patch.visibility, '::post_visibility');
      if (patch.allowDownload !== undefined) add('allow_download', patch.allowDownload);
      if (patch.coverVariant !== undefined) add('cover_variant', patch.coverVariant);
      const r = await c.query(`UPDATE posts SET ${sets.join(', ')} WHERE id = $1 AND author_id = $2`, args);
      if (!r.rowCount) { await c.query('ROLLBACK'); return false; }
      if (patch.tags) {
        await c.query('DELETE FROM post_hashtags WHERE post_id = $1', [postId]);
        for (const tag of patch.tags) {
          const h = await c.query<{ id: number }>('INSERT INTO hashtags(tag) VALUES ($1) ON CONFLICT (tag) DO UPDATE SET tag = EXCLUDED.tag RETURNING id', [tag]);
          await c.query('INSERT INTO post_hashtags(post_id, hashtag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [postId, h.rows[0]!.id]);
        }
      }
      await c.query('COMMIT');
      return true;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  /** Etiquetas en tendencia (últimos 14 días, solo publicaciones públicas de perfiles abiertos). */
  async trendingTags(): Promise<{ tag: string; posts: number }[]> {
    return (await pool.query(
      `SELECT h.tag::text AS tag, count(*)::int AS posts FROM post_hashtags x JOIN hashtags h ON h.id = x.hashtag_id JOIN posts p ON p.id = x.post_id
       JOIN photos ph ON ph.post_id = p.id AND ph.status IN ('ready','partial')
       WHERE p.visibility = 'public' AND p.created_at > now() - interval '14 days' AND NOT EXISTS (SELECT 1 FROM profiles pv WHERE pv.user_id = p.author_id AND pv.is_private)
       GROUP BY h.tag ORDER BY posts DESC, h.tag LIMIT 8`)).rows;
  },

  async authorInfo(postId: string): Promise<{ authorId: string; username: string; visibility: 'public' | 'followers' | 'private' } | undefined> {
    const r = (await pool.query('SELECT p.author_id, u.username::text AS username, p.visibility::text AS visibility FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = $1', [postId])).rows[0];
    return r && { authorId: r.author_id, username: r.username, visibility: r.visibility };
  },

  async ownedPhoto(authorId: string, postId: string): Promise<{ photoId: string; status: string } | undefined> {
    const r = await pool.query<{ photo_id: string; status: string }>('SELECT ph.id AS photo_id, ph.status::text AS status FROM photos ph JOIN posts p ON p.id = ph.post_id WHERE p.id = $1 AND p.author_id = $2', [postId, authorId]);
    return r.rows[0] && { photoId: r.rows[0].photo_id, status: r.rows[0].status };
  },

  /** Devuelve las claves de almacenamiento para borrar los objetos tras eliminar la fila. */
  async deleteOwned(authorId: string, postId: string): Promise<{ bucket: string; key: string }[] | null> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const own = await c.query('SELECT 1 FROM posts WHERE id = $1 AND author_id = $2 FOR UPDATE', [postId, authorId]);
      if (!own.rowCount) { await c.query('ROLLBACK'); return null; }
      const keys = (await c.query<{ bucket: string; key: string }>(
        `SELECT bucket, storage_key AS key FROM photos WHERE post_id = $1
         UNION ALL SELECT v.bucket, v.storage_key FROM photo_variants v JOIN photos ph ON ph.id = v.photo_id WHERE ph.post_id = $1`, [postId])).rows;
      await c.query('DELETE FROM posts WHERE id = $1', [postId]);
      await c.query('COMMIT');
      return keys;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  },

  /** Ubicación de una variante; solo si el espectador puede ver la publicación. El original solo existe para lectura una vez saneado. */
  async mediaLocation(viewerId: string, photoId: string, variant: string): Promise<{ bucket: string; key: string; mime: string; allowDownload: boolean; isOwner: boolean } | undefined> {
    const vis = `EXISTS (SELECT 1 FROM posts p JOIN users u ON u.id = p.author_id AND u.deleted_at IS NULL WHERE p.id = ph.post_id AND ${VISIBLE})`;
    const meta = `(SELECT p.allow_download FROM posts p WHERE p.id = ph.post_id) AS "allowDownload", (SELECT p.author_id = $1 FROM posts p WHERE p.id = ph.post_id) AS "isOwner"`;
    if (variant === 'original') {
      const r = await pool.query(`SELECT ph.bucket, ph.storage_key AS key, ph.mime, ${meta} FROM photos ph WHERE ph.id = $2 AND ph.sanitized AND ${vis}`, [viewerId, photoId]);
      return r.rows[0];
    }
    const r = await pool.query(`SELECT v.bucket, v.storage_key AS key, v.mime, ${meta} FROM photo_variants v JOIN photos ph ON ph.id = v.photo_id WHERE ph.id = $2 AND v.kind = $3::variant_kind AND ${vis}`, [viewerId, photoId, variant]);
    return r.rows[0];
  },
};
