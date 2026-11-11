import { pool } from '../../db/pool.js';
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
}

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
  async notify(userId: string, actorId: string, type: 'like' | 'comment' | 'follow', postId?: string) {
    if (userId === actorId) return;
    await pool.query('INSERT INTO notifications(user_id, actor_id, type, post_id) VALUES ($1,$2,$3,$4)', [userId, actorId, type, postId ?? null]);
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
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.bio, pr.avatar_key, u.created_at,
        (SELECT count(*) FROM posts p WHERE p.author_id = u.id AND (p.visibility = 'public' OR u.id = $1))::int AS post_count,
        (SELECT count(*) FROM follows WHERE followee_id = u.id)::int AS follower_count,
        (SELECT count(*) FROM follows WHERE follower_id = u.id)::int AS following_count,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = u.id) AS following
       FROM users u JOIN profiles pr ON pr.user_id = u.id WHERE u.username = $2 AND u.deleted_at IS NULL`, [viewerId, username])).rows[0];
    if (!r) return undefined;
    return { ...author(r), bio: r.bio, createdAt: r.created_at.toISOString(), postCount: r.post_count, followerCount: r.follower_count, followingCount: r.following_count, isMe: r.id === viewerId, following: r.following };
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
  },
  async relations(viewerId: string, userId: string, kind: 'followers' | 'following') {
    const [self, other] = kind === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
    const rows = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key,
        EXISTS (SELECT 1 FROM follows x WHERE x.follower_id = $2 AND x.followee_id = u.id) AS following
       FROM follows f JOIN users u ON u.id = f.${other} AND u.deleted_at IS NULL JOIN profiles pr ON pr.user_id = u.id
       WHERE f.${self} = $1 ORDER BY f.created_at DESC LIMIT 100`, [userId, viewerId])).rows;
    return rows.map((r) => ({ ...author(r), following: r.following, isMe: r.id === viewerId }));
  },
  async suggestions(viewerId: string) {
    const rows = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key,
         (SELECT count(*) FROM follows WHERE followee_id = u.id)::int AS followers
       FROM users u JOIN profiles pr ON pr.user_id = u.id
       WHERE u.deleted_at IS NULL AND u.id <> $1 AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id)
         AND EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.visibility = 'public')
       ORDER BY followers DESC, u.created_at DESC LIMIT 5`, [viewerId])).rows;
    return rows.map((r) => ({ ...author(r), following: false, isMe: false }));
  },
  async searchUsers(viewerId: string, q: string) {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = (await pool.query(
      `SELECT u.id, u.username::text AS username, pr.display_name, pr.avatar_key,
        EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followee_id = u.id) AS following
       FROM users u JOIN profiles pr ON pr.user_id = u.id
       WHERE u.deleted_at IS NULL AND (u.username::text ILIKE $2 OR pr.display_name ILIKE $2)
       ORDER BY (u.username::text ILIKE $3) DESC, u.username LIMIT 20`, [viewerId, like, `${q.replace(/[%_\\]/g, '\\$&')}%`])).rows;
    return rows.map((r) => ({ ...author(r), following: r.following, isMe: r.id === viewerId }));
  },
  async searchHashtags(q: string) {
    const rows = (await pool.query(
      `SELECT h.tag::text AS tag, count(*)::int AS posts FROM hashtags h JOIN post_hashtags x ON x.hashtag_id = h.id JOIN posts p ON p.id = x.post_id AND p.visibility = 'public'
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
