import { pool } from '../../db/pool.js';
import { publish } from '../../events/hub.js';
import { avatarUrl, decodeCursor, encodeCursor, type AuthorDTO, type Page } from './dto.js';

export interface CommentDTO {
  id: string;
  body: string;
  createdAt: string;
  author: AuthorDTO;
  canDelete: boolean;
}

export interface ProfileDTO extends AuthorDTO {
  bio: string;
  createdAt: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  isMe: boolean;
  following: boolean;
  isPrivate: boolean;
  followRequested: boolean;
  /** false = perfil privado que el espectador aún no puede ver. */
  canView: boolean;
}

export type NotifPrefs = { follow: boolean; like: boolean; comment: boolean; follow_request: boolean };
const DEFAULT_PREFS: NotifPrefs = { follow: true, like: true, comment: true, follow_request: true };
const CATEGORY_LABEL: Record<string, string> = { naturaleza: 'Naturaleza', arquitectura: 'Arquitectura', retratos: 'Retratos', viajes: 'Viajes', arte: 'Arte', urbana: 'Urbana', gastronomia: 'Gastronomía' };

/** Columnas comunes para listas de personas (espectador = $1). */
const PERSON_FLAGS = `EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = $1 AND fr.target_id = u.id) AS requested, pr.is_private`;

const author = (r: { id: string; username: string; display_name: string; avatar_key: string | null }): AuthorDTO => ({
  id: r.id, username: r.username, displayName: r.display_name, avatarUrl: avatarUrl(r.id, r.avatar_key),
});

export const socialRepository = {
  // ---------- likes / guardados (idempotentes) ----------
  async like(userId: string, postId: string): Promise<boolean> {
    const r = await pool.query('INSERT INTO likes(user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, postId]);
    return (r.rowCount ?? 0) > 0;
  },
  async unlike(userId: string, postId: string) {
    await pool.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
  },
  async save(userId: string, postId: string) {
    await pool.query('INSERT INTO saves(user_id, post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, postId]);
  },
  async unsave(userId: string, postId: string) {
    await pool.query('DELETE FROM saves WHERE user_id = $1 AND post_id = $2', [userId, postId]);
  },
  async counts(postId: string) {
    const r = await pool.query<{ likes: number; comments: number }>(
      'SELECT (SELECT count(*) FROM likes WHERE post_id = $1)::int AS likes, (SELECT count(*) FROM comments WHERE post_id = $1)::int AS comments', [postId]);
    return r.rows[0]!;
  },
  async postAuthor(postId: string): Promise<string | undefined> {
    return (await pool.query<{ author_id: string }>('SELECT author_id FROM posts WHERE id = $1', [postId])).rows[0]?.author_id;
  },
  async notify(userId: string, actorId: string, type: 'like' | 'comment' | 'follow' | 'follow_request' | 'follow_accepted', postId?: string) {
    if (userId === actorId) return;
    const prefs = { ...DEFAULT_PREFS, ...((await pool.query<{ notif_prefs: Partial<NotifPrefs> }>('SELECT notif_prefs FROM profiles WHERE user_id = $1', [userId])).rows[0]?.notif_prefs ?? {}) };
    if (type in prefs && !prefs[type as keyof NotifPrefs]) return;
    // «Me gusta» repetidos del mismo autor sobre la misma foto no vuelven a notificar mientras la anterior siga sin leer
    if (type === 'like') {
      const dup = await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND actor_id = $2 AND type = 'like' AND post_id = $3 AND read_at IS NULL", [userId, actorId, postId]);
      if (dup.rowCount) return;
    }
    const id = (await pool.query<{ id: string }>('INSERT INTO notifications(user_id, actor_id, type, post_id) VALUES ($1,$2,$3,$4) RETURNING id', [userId, actorId, type, postId ?? null])).rows[0]!.id;
    const a = (await pool.query<{ username: string; display_name: string }>('SELECT u.username::text AS username, pr.display_name FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.id = $1', [actorId])).rows[0];
    await publish({ kind: 'notification', userId, id, type, actor: a ? { username: a.username, displayName: a.display_name } : null, postId: postId ?? null });
  },

  // ---------- comentarios ----------
  async comments(viewerId: string, postId: string, cursor?: string): Promise<Page<CommentDTO>> {
    const c = decodeCursor(cursor);
    const args: unknown[] = [postId, viewerId];
    let cur = '';
    if (c) { args.push(c.at, c.id); cur = ` AND (c.created_at, c.id) > ($3::timestamptz, $4::uuid)`; }
    const rows = (await pool.query(
      `SELECT c.id, c.body, c.created_at, c.created_at::text AS created_text, c.author_id, u.username::text AS username, pr.display_name, pr.avatar_key,
              (c.author_id = $2 OR p.author_id = $2) AS can_delete
       FROM comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = c.author_id AND u.deleted_at IS NULL JOIN profiles pr ON pr.user_id = u.id
       WHERE c.post_id = $1${cur} ORDER BY c.created_at ASC, c.id ASC LIMIT 31`, args)).rows;
    const page = rows.slice(0, 30);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ id: r.id, body: r.body, createdAt: r.created_at.toISOString(), canDelete: r.can_delete, author: author({ id: r.author_id, username: r.username, display_name: r.display_name, avatar_key: r.avatar_key }) })),
      nextCursor: rows.length > 30 && last ? encodeCursor(last.created_text, last.id) : null,
    };
  },
  async addComment(userId: string, postId: string, body: string) {
    return (await pool.query<{ id: string }>('INSERT INTO comments(post_id, author_id, body) VALUES ($1,$2,$3) RETURNING id', [postId, userId, body])).rows[0]!.id;
  },
  async commentById(viewerId: string, id: string): Promise<CommentDTO | undefined> {
    const r = (await pool.query(
      `SELECT c.id, c.body, c.created_at, c.author_id, u.username::text AS username, pr.display_name, pr.avatar_key, (c.author_id = $2 OR p.author_id = $2) AS can_delete
       FROM comments c JOIN posts p ON p.id = c.post_id JOIN users u ON u.id = c.author_id JOIN profiles pr ON pr.user_id = u.id WHERE c.id = $1`, [id, viewerId])).rows[0];
    return r && { id: r.id, body: r.body, createdAt: r.created_at.toISOString(), canDelete: r.can_delete, author: author({ id: r.author_id, username: r.username, display_name: r.display_name, avatar_key: r.avatar_key }) };
  },
  /** Puede borrar el autor del comentario o el dueño de la publicación. */
  async deleteComment(userId: string, id: string): Promise<boolean> {
    const r = await pool.query('DELETE FROM comments c USING posts p WHERE c.id = $1 AND p.id = c.post_id AND (c.author_id = $2 OR p.author_id = $2)', [id, userId]);
    return (r.rowCount ?? 0) > 0;
  },

  // ---------- perfiles y relaciones ----------
  async profile(viewerId: string, username: string): Promise<ProfileDTO | undefined> {
    const r = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.bio, pr.avatar_key, pr.is_private, u.created_at,
        (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND (p.visibility = 'public' OR u.id = $1))::int AS post_count,
        (SELECT count(*) FROM follows WHERE followee_id = u.id)::int AS follower_count,
        (SELECT count(*) FROM follows WHERE follower_id = u.id)::int AS following_count,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = u.id) AS following,
        EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = $1 AND target_id = u.id) AS requested
       FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.username = $2 AND u.deleted_at IS NULL`, [viewerId, username])).rows[0];
    if (!r) return undefined;
    return { ...author(r), bio: r.bio, createdAt: r.created_at.toISOString(), postCount: r.post_count, followerCount: r.follower_count, followingCount: r.following_count, isMe: r.id === viewerId, following: r.following, isPrivate: r.is_private, followRequested: r.requested, canView: r.id === viewerId || !r.is_private || r.following };
  },
  async userIdByUsername(username: string): Promise<string | undefined> {
    return (await pool.query<{ id: string }>('SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL', [username])).rows[0]?.id;
  },
  async follow(followerId: string, followeeId: string): Promise<boolean> {
    const r = await pool.query('INSERT INTO follows(follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [followerId, followeeId]);
    return (r.rowCount ?? 0) > 0;
  },
  async unfollow(followerId: string, followeeId: string) {
    await pool.query('DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2', [followerId, followeeId]);
    await pool.query('DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2', [followerId, followeeId]);
  },
  async isPrivate(userId: string): Promise<boolean> {
    return (await pool.query<{ is_private: boolean }>('SELECT is_private FROM profiles WHERE user_id = $1', [userId])).rows[0]?.is_private ?? false;
  },
  async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    return ((await pool.query('SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2', [followerId, followeeId])).rowCount ?? 0) > 0;
  },
  /** Solicitud de seguimiento a un perfil privado (idempotente). Devuelve true si es nueva. */
  async requestFollow(requesterId: string, targetId: string): Promise<boolean> {
    const r = await pool.query('INSERT INTO follow_requests(requester_id, target_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [requesterId, targetId]);
    return (r.rowCount ?? 0) > 0;
  },
  async pendingRequests(targetId: string) {
    const rows = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key, fr.created_at FROM follow_requests fr
       JOIN users u ON u.id = fr.requester_id AND u.deleted_at IS NULL JOIN profiles pr ON pr.user_id = u.id
       WHERE fr.target_id = $1 ORDER BY fr.created_at DESC LIMIT 100`, [targetId])).rows;
    return rows.map((r) => ({ ...author(r), requestedAt: (r.created_at as Date).toISOString() }));
  },
  /** Acepta (crea el seguimiento) o rechaza una solicitud. Devuelve false si no existía. */
  async resolveRequest(targetId: string, requesterId: string, accept: boolean): Promise<boolean> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const del = await c.query('DELETE FROM follow_requests WHERE requester_id = $1 AND target_id = $2', [requesterId, targetId]);
      if (!del.rowCount) { await c.query('ROLLBACK'); return false; }
      if (accept) await c.query('INSERT INTO follows(follower_id, followee_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [requesterId, targetId]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
    if (accept) await socialRepository.notify(requesterId, targetId, 'follow_accepted');
    return true;
  },
  async getSettings(userId: string) {
    const r = (await pool.query<{ is_private: boolean; notif_prefs: Partial<NotifPrefs> }>('SELECT is_private, notif_prefs FROM profiles WHERE user_id = $1', [userId])).rows[0]!;
    const pending = (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM follow_requests WHERE target_id = $1', [userId])).rows[0]!.n;
    return { isPrivate: r.is_private, notifPrefs: { ...DEFAULT_PREFS, ...r.notif_prefs } as NotifPrefs, pendingRequests: pending };
  },
  async updateSettings(userId: string, patch: { isPrivate?: boolean; notifPrefs?: Partial<NotifPrefs> }) {
    if (patch.notifPrefs) await pool.query('UPDATE profiles SET notif_prefs = notif_prefs || $2::jsonb WHERE user_id = $1', [userId, JSON.stringify(patch.notifPrefs)]);
    if (patch.isPrivate !== undefined) {
      await pool.query('UPDATE profiles SET is_private = $2 WHERE user_id = $1', [userId, patch.isPrivate]);
      if (!patch.isPrivate) {
        // Al abrir el perfil, las solicitudes pendientes se aceptan
        await pool.query('INSERT INTO follows(follower_id, followee_id) SELECT requester_id, target_id FROM follow_requests WHERE target_id = $1 ON CONFLICT DO NOTHING', [userId]);
        await pool.query('DELETE FROM follow_requests WHERE target_id = $1', [userId]);
      }
    }
  },

  // ---------- notificaciones ----------
  async notifications(userId: string, cursor?: string) {
    const c = decodeCursor(cursor);
    const args: unknown[] = [userId];
    let cur = '';
    if (c) { args.push(c.at, c.id); cur = ' AND (n.created_at, n.id) < ($2::timestamptz, $3::uuid)'; }
    const rows = (await pool.query(
      `SELECT n.id, n.type::text AS type, n.read_at, n.created_at, n.created_at::text AS created_text, n.post_id,
              a.id AS actor_id, a.username::text AS username, ap.display_name, ap.avatar_key,
              (SELECT ph.id FROM photos ph WHERE ph.post_id = n.post_id LIMIT 1) AS photo_id,
              EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = n.actor_id AND fr.target_id = n.user_id) AS pending,
              EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = n.user_id AND f.followee_id = n.actor_id) AS i_follow
       FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN profiles ap ON ap.user_id = a.id
       WHERE n.user_id = $1${cur} ORDER BY n.created_at DESC, n.id DESC LIMIT 31`, args)).rows;
    const page = rows.slice(0, 30);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id as string, type: r.type as string, read: r.read_at !== null, createdAt: (r.created_at as Date).toISOString(), postId: r.post_id as string | null,
        thumbUrl: r.photo_id ? `/api/media/photo/${r.photo_id}/thumbnail` : null,
        actor: r.actor_id ? author({ id: r.actor_id, username: r.username, display_name: r.display_name, avatar_key: r.avatar_key }) : null,
        pending: r.type === 'follow_request' ? (r.pending as boolean) : false, following: r.i_follow as boolean,
      })),
      nextCursor: rows.length > 30 && last ? encodeCursor(last.created_text, last.id) : null,
    };
  },
  async unreadCount(userId: string): Promise<number> {
    return (await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0]!.n;
  },
  async markRead(userId: string, ids?: string[]) {
    if (ids) await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])', [userId, ids]);
    else await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  },
  async relations(viewerId: string, userId: string, kind: 'followers' | 'following') {
    const [self, other] = kind === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
    const rows = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key,
        EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = $2 AND x.followee_id = u.id) AS following,
        EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = $2 AND fr.target_id = u.id) AS requested, pr.is_private
       FROM follows f JOIN users u ON u.id = f.${other} AND u.deleted_at IS NULL JOIN profiles pr ON pr.user_id = u.id
       WHERE f.${self} = $1 ORDER BY f.created_at DESC LIMIT 100`, [userId, viewerId])).rows;
    return rows.map((r) => ({ ...author(r), following: r.following, isMe: r.id === viewerId, requested: r.requested, isPrivate: r.is_private }));
  },
  /**
   * Sugerencias con motivo: te siguen, conocidos en común, intereses compartidos (categorías que publicas o te gustan)
   * y popularidad. Excluye a quien ya sigues o ya solicitaste.
   */
  async suggestions(viewerId: string) {
    const rows = (await pool.query(
      `WITH my_cats AS (
         SELECT category, count(*) AS w FROM (
           SELECT p.category FROM posts p WHERE p.author_id = $1 AND p.category IS NOT NULL
           UNION ALL SELECT p.category FROM likes l JOIN posts p ON p.id = l.post_id WHERE l.user_id = $1 AND p.category IS NOT NULL
         ) x GROUP BY category
       )
       SELECT * FROM (
         SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key, pr.is_private, u.created_at,
           (SELECT count(*) FROM follows WHERE followee_id = u.id)::int AS followers,
           EXISTS (SELECT 1 FROM follows WHERE follower_id = u.id AND followee_id = $1) AS follows_me,
           (SELECT count(*) FROM follows f1 JOIN follows f2 ON f2.follower_id = f1.followee_id WHERE f1.follower_id = $1 AND f2.followee_id = u.id)::int AS mutuals,
           (SELECT mc.category::text FROM my_cats mc WHERE EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.visibility = 'public' AND p.category = mc.category) ORDER BY mc.w DESC LIMIT 1) AS shared_cat
         FROM users u JOIN profiles pr ON pr.user_id = u.id
         WHERE u.deleted_at IS NULL AND u.id <> $1
           AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM follow_requests fr WHERE fr.requester_id = $1 AND fr.target_id = u.id)
           AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.visibility = 'public')
       ) s
       ORDER BY (follows_me::int * 5 + mutuals * 3 + (shared_cat IS NOT NULL)::int * 2 + LEAST(followers, 10) * 0.2) DESC, created_at DESC LIMIT 6`, [viewerId])).rows;
    return rows.map((r) => ({
      ...author(r), following: false, isMe: false, requested: false, isPrivate: r.is_private,
      reason: r.mutuals > 0 ? (r.mutuals === 1 ? 'Lo sigue 1 persona que sigues' : `Lo siguen ${r.mutuals} personas que sigues`)
        : r.follows_me ? 'Te sigue'
        : r.shared_cat ? `También publica en ${CATEGORY_LABEL[r.shared_cat] ?? r.shared_cat}`
        : r.followers > 0 ? 'Popular en LUMENZA' : 'Nuevo en LUMENZA',
    }));
  },
  async searchUsers(viewerId: string, q: string) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key,
        EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following, ${PERSON_FLAGS}
       FROM users u JOIN profiles pr ON pr.user_id = u.id
       WHERE u.deleted_at IS NULL AND (u.username::text ILIKE $2 OR pr.display_name ILIKE $2)
       ORDER BY (u.username::text ILIKE $3) DESC, u.username LIMIT 20`, [viewerId, like, `${q.replace(/[%_\\]/g, '\\$&')}%`])).rows;
    return rows.map((r) => ({ ...author(r), following: r.following, isMe: r.id === viewerId, requested: r.requested, isPrivate: r.is_private }));
  },
  async searchHashtags(q: string) {
    const rows = (await pool.query(
      `SELECT h.tag::text AS tag, count(*)::int AS posts FROM hashtags h JOIN post_hashtags x ON x.hashtag_id = h.id JOIN posts p ON p.id = x.post_id AND p.visibility = 'public' AND NOT EXISTS (SELECT 1 FROM profiles pv WHERE pv.user_id = p.author_id AND pv.is_private)
       WHERE h.tag::text ILIKE $1 GROUP BY h.tag ORDER BY posts DESC, h.tag LIMIT 20`, [`${q.replace(/[%_\\]/g, '\\$&')}%`])).rows;
    return rows as { tag: string; posts: number }[];
  },
  async updateProfile(userId: string, displayName: string, bio: string) {
    await pool.query('UPDATE profiles SET display_name = $2, bio = $3 WHERE user_id = $1', [userId, displayName, bio]);
  },
  async setAvatar(userId: string, key: string): Promise<string | null> {
    const old = (await pool.query<{ avatar_key: string | null }>('SELECT avatar_key FROM profiles WHERE user_id = $1', [userId])).rows[0]?.avatar_key ?? null;
    await pool.query('UPDATE profiles SET avatar_key = $2 WHERE user_id = $1', [userId, key]);
    return old;
  },
  async avatarKey(userId: string): Promise<string | undefined> {
    return (await pool.query<{ avatar_key: string | null }>('SELECT avatar_key FROM profiles WHERE user_id = $1', [userId])).rows[0]?.avatar_key ?? undefined;
  },
};
