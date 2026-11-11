// Integración REAL: PostgreSQL + RustFS (S3) + worker de procesamiento real (pg-boss) con imágenes generadas por sharp.
process.env.PHOTO_QUEUE = 'process-photo-it-social'; // cola aislada del worker de desarrollo
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers.js';

const run = process.env.INTEGRATION === '1';
const jpeg = (w = 900, h = 600, color = '#9673f7') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();

describe.skipIf(!run)('Social: publicaciones, feed, perfiles, interacciones', async () => {
  const { createApp } = await import('../../app.js');
  const { pool } = await import('../../db/pool.js');
  const { getStorage } = await import('../../storage/index.js');
  const { startWorker } = await import('../../jobs/worker-core.js');
  const app = createApp({ mailer: { send: async () => undefined } });
  let worker: Awaited<ReturnType<typeof startWorker>>;
  const tag = `${Date.now().toString(36)}s`;
  const pw = 'Clave-segura-123';
  const users = ['a', 'b', 'c'].map((k) => ({ k, username: `s${k}_${tag}`, email: `s${k}_${tag}@example.com`, cookie: [] as string[], id: '' }));
  const [A, B, C] = users as [typeof users[0], typeof users[0], typeof users[0]];
  const as = (u: typeof A) => ({
    get: (url: string) => request(app).get(url).set('Cookie', u.cookie),
    post: (url: string) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
    patch: (url: string) => request(app).patch(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
    del: (url: string) => request(app).delete(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
  });
  const publish = async (u: typeof A, fields: Record<string, string> = {}, img?: Buffer) => {
    let r = as(u).post('/api/posts').attach('photo', img ?? (await jpeg()), { filename: 'foto.jpg', contentType: 'image/jpeg' });
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  };
  /** Espera (hasta 90 s) a que el worker deje la fotografía en «ready». */
  const waitReady = async (u: typeof A, postId: string) => {
    for (let i = 0; i < 360; i++) {
      const r = await as(u).get(`/api/posts/${postId}`);
      if (r.body.post?.processing.status === 'ready') return r.body.post;
      if (r.body.post?.processing.status === 'failed') throw new Error(`Procesamiento fallido: ${r.body.post.processing.error}`);
      await new Promise((r2) => setTimeout(r2, 250));
    }
    throw new Error('Tiempo de espera agotado esperando el procesamiento');
  };
  const publishReady = async (u: typeof A, fields: Record<string, string> = {}, img?: Buffer) => {
    const r = await publish(u, fields, img);
    expect(r.status).toBe(202);
    return waitReady(u, r.body.post.id);
  };
  let post: { id: string; photo: { id: string } };

  beforeAll(async () => {
    worker = await startWorker({ workerId: 'it-social', concurrency: 2 });
    for (const u of users) {
      const r = await request(app).post('/api/auth/register').set('Origin', ORIGIN).send({ displayName: `Usuario ${u.k}`, username: u.username, email: u.email, password: pw, confirmPassword: pw });
      u.cookie = r.headers['set-cookie'] as unknown as string[];
      u.id = r.body.user.id;
    }
  });
  afterAll(async () => {
    const posts = (await pool.query('SELECT ph.storage_key AS k FROM photos ph JOIN posts p ON p.id = ph.post_id WHERE p.author_id = ANY($1)', [users.map((u) => u.id)])).rows;
    for (const p of posts) await getStorage().delete(p.k).catch(() => undefined);
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`s_\\_${tag}%`.replace('s_\\_', 's%_')]);
    await worker.stop();
    await pool.end();
  });

  it('publica una foto: valida, guarda en S3 y solo metadatos en PostgreSQL', async () => {
    const res = await publish(A, { caption: 'Atardecer #luz', category: 'naturaleza', visibility: 'public', tags: 'Montaña, ÁRBOL' });
    expect(res.status).toBe(202); // aceptada: el procesamiento es asíncrono
    expect(res.body.post.processing.status).toMatch(/pending|processing/);
    post = await waitReady(A, res.body.post.id);
    expect(post.processing).toMatchObject({ status: 'ready', progress: 100 });
    expect([...res.body.post.tags].sort()).toEqual(['arbol', 'luz', 'montana']);
    expect(post.photo).toMatchObject({ width: 900, height: 600 });
    const ph = (await pool.query('SELECT storage_key, bucket, status, sha256, bytes FROM photos WHERE id = $1', [post.photo.id])).rows[0];
    expect(ph.status).toBe('ready');
    expect(ph.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await getStorage().exists(ph.storage_key)).toBe(true);
    const variants = (await pool.query('SELECT kind::text AS kind, storage_key FROM photo_variants WHERE photo_id = $1 ORDER BY kind::text', [post.photo.id])).rows;
    expect(variants.map((v) => v.kind)).toEqual(['bw_editorial', 'display', 'lumen_tone', 'sepia_cinema', 'thumbnail']);
    for (const v of variants) expect(await getStorage().exists(v.storage_key)).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND data_type='bytea'")).rows[0].n).toBe(0);
  });

  it('rechaza archivos no válidos por CONTENIDO (no por extensión), formatos, tamaño y ausencia', async () => {
    const fake = await publish(A, {}, Buffer.from('<?php echo 1; ?> esto no es una imagen'));
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('invalid_image');
    const svg = await publish(A, {}, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><script>alert(1)</script></svg>'));
    expect(svg.status).toBe(400);
    const gif = await publish(A, {}, await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } }).gif().toBuffer());
    expect(gif.body.error.code).toBe('unsupported_format');
    const tiny = await publish(A, {}, await jpeg(100, 100));
    expect(tiny.body.error.code).toBe('image_too_small');
    const big = await as(A).post('/api/posts').attach('photo', randomBytes(16 * 1024 * 1024), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('file_too_large');
    expect((await as(A).post('/api/posts')).body.error.code).toBe('file_required');
    expect((await publish(A, { visibility: 'secreta' })).status).toBe(400);
  });

  it('sirve miniatura y versión de visualización como WebP; el original solo si se permite la descarga', async () => {
    const d = await as(B).get(`/api/media/photo/${post.photo.id}/display`);
    expect(d.status).toBe(200);
    expect(d.headers['content-type']).toBe('image/webp');
    expect((await sharp(d.body).metadata()).format).toBe('webp');
    expect((await as(B).get(`/api/media/photo/${post.photo.id}/thumbnail`)).status).toBe(200);
    expect((await as(B).get(`/api/media/photo/${post.photo.id}/original`)).status).toBe(404); // descarga no permitida
    expect((await as(A).get(`/api/media/photo/${post.photo.id}/original`)).status).toBe(200); // el autor sí
    expect((await request(app).get(`/api/media/photo/${post.photo.id}/display`)).status).toBe(401);
  });

  it('visibilidad: privada solo el autor; "followers" solo seguidores', async () => {
    const priv = await publishReady(A, { visibility: 'private', caption: 'privada' });
    const fol = await publishReady(A, { visibility: 'followers', caption: 'seguidores' });
    expect((await as(B).get(`/api/posts/${priv.id}`)).status).toBe(404);
    expect((await as(B).get(`/api/media/photo/${priv.photo.id}/display`)).status).toBe(404);
    expect((await as(A).get(`/api/posts/${priv.id}`)).status).toBe(200);
    expect((await as(B).get(`/api/posts/${fol.id}`)).status).toBe(404);
    expect((await as(B).post(`/api/users/${A.username}/follow`)).status).toBe(200);
    expect((await as(B).get(`/api/posts/${fol.id}`)).status).toBe(200);
    expect((await as(B).get(`/api/media/photo/${fol.photo.id}/thumbnail`)).status).toBe(200);
    const exp = await as(C).get('/api/explore');
    expect(JSON.stringify(exp.body)).not.toContain(priv.id);
    expect(JSON.stringify(exp.body)).not.toContain(fol.id);
  });

  it('seguir/dejar de seguir: contadores reales, idempotencia, no auto-seguirse y notificación', async () => {
    const p = (await as(A).get(`/api/users/${A.username}`)).body.profile;
    expect(p).toMatchObject({ followerCount: 1, followingCount: 0, isMe: true });
    expect((await as(B).post(`/api/users/${A.username}/follow`)).body.profile.followerCount).toBe(1); // idempotente
    expect((await as(A).post(`/api/users/${A.username}/follow`)).status).toBe(400);
    expect((await as(B).get(`/api/users/${A.username}/followers`)).body.items.map((u: { username: string }) => u.username)).toEqual([B.username]);
    expect((await as(B).get(`/api/users/${B.username}/following`)).body.items[0].username).toBe(A.username);
    expect((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'follow'", [A.id])).rows[0].n).toBe(1);
    expect((await as(C).post('/api/users/no_existe_xyz/follow')).status).toBe(404);
  });

  it('feed: solo seguidos y propios, paginado por cursor sin duplicados', async () => {
    expect((await as(C).get('/api/feed')).body.items).toHaveLength(0); // C no sigue a nadie
    const ids: string[] = [];
    const small = await jpeg(420, 300, '#c4b5fd');
    for (let i = 0; i < 13; i++) ids.push((await publish(A, { caption: `lote ${i}`, visibility: 'public' }, small)).body.post.id);
    for (const id of ids) await waitReady(A, id);
    expect((await as(B).post(`/api/users/${A.username}/follow`)).status).toBe(200);
    const p1 = (await as(B).get('/api/feed')).body;
    expect(p1.items).toHaveLength(12);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await as(B).get(`/api/feed?cursor=${p1.nextCursor}`)).body;
    const all = [...p1.items, ...p2.items].map((x: { id: string }) => x.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(p1.items[0].caption).toBe('lote 12'); // más reciente primero
    expect((await as(B).get('/api/feed?cursor=basura')).status).toBe(200); // cursor inválido se ignora
  });

  it('likes y guardados: idempotentes, contadores reales, guardados privados y notificación', async () => {
    const l1 = (await as(B).post(`/api/posts/${post.id}/like`)).body;
    const l2 = (await as(B).post(`/api/posts/${post.id}/like`)).body;
    expect(l1).toMatchObject({ likeCount: 1, liked: true });
    expect(l2.likeCount).toBe(1);
    expect((await as(C).get(`/api/posts/${post.id}`)).body.post).toMatchObject({ likeCount: 1, liked: false });
    expect((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'like'", [A.id])).rows[0].n).toBe(1);
    expect((await as(B).del(`/api/posts/${post.id}/like`)).body).toMatchObject({ likeCount: 0, liked: false });
    expect((await as(B).post(`/api/posts/${post.id}/save`)).body.saved).toBe(true);
    expect((await as(B).get('/api/me/saved')).body.items.map((x: { id: string }) => x.id)).toEqual([post.id]);
    expect((await as(A).get('/api/me/saved')).body.items).toHaveLength(0);
    expect((await as(B).del(`/api/posts/${post.id}/save`)).body.saved).toBe(false);
    expect((await as(B).post('/api/posts/00000000-0000-4000-8000-000000000000/like')).status).toBe(404);
  });

  it('comentarios: crear, listar, validar; borra el autor del comentario o el dueño de la publicación', async () => {
    const c1 = await as(B).post(`/api/posts/${post.id}/comments`).send({ body: '  Preciosa luz  ' });
    expect(c1.status).toBe(201);
    expect(c1.body.comment).toMatchObject({ body: 'Preciosa luz', canDelete: true });
    expect(c1.body.commentCount).toBe(1);
    const c2 = await as(C).post(`/api/posts/${post.id}/comments`).send({ body: '<img src=x onerror=alert(1)>' });
    expect(c2.body.comment.body).toBe('<img src=x onerror=alert(1)>'); // se almacena literal; React lo escapa al renderizar
    expect((await as(B).post(`/api/posts/${post.id}/comments`).send({ body: '   ' })).status).toBe(400);
    expect((await as(B).post(`/api/posts/${post.id}/comments`).send({ body: 'x'.repeat(1001) })).status).toBe(400);
    const list = (await as(A).get(`/api/posts/${post.id}/comments`)).body.items;
    expect(list.map((c: { body: string }) => c.body)[0]).toBe('Preciosa luz');
    expect(list.every((c: { canDelete: boolean }) => c.canDelete)).toBe(true); // A es dueño de la publicación
    expect((await as(C).del(`/api/comments/${c1.body.comment.id}`)).status).toBe(404); // C no puede borrar el de B
    expect((await as(B).del(`/api/comments/${c1.body.comment.id}`)).status).toBe(204);
    expect((await as(A).del(`/api/comments/${c2.body.comment.id}`)).status).toBe(204); // dueño de la publicación
    expect((await as(A).get(`/api/posts/${post.id}`)).body.post.commentCount).toBe(0);
  });

  it('explorar: categoría, hashtag y búsqueda; búsqueda de usuarios y hashtags', async () => {
    const cat = (await as(C).get('/api/explore?category=naturaleza')).body.items;
    expect(cat.map((x: { id: string }) => x.id)).toContain(post.id);
    expect((await as(C).get('/api/explore?category=arte')).body.items.map((x: { id: string }) => x.id)).not.toContain(post.id);
    expect((await as(C).get('/api/explore?tag=montana')).body.items.map((x: { id: string }) => x.id)).toContain(post.id);
    expect((await as(C).get('/api/explore?q=atardecer')).body.items.map((x: { id: string }) => x.id)).toContain(post.id);
    expect((await as(C).get('/api/explore?category=inventada')).status).toBe(400);
    expect((await as(C).get(`/api/search/users?q=${A.username.slice(0, 8)}`)).body.items.some((u: { username: string }) => u.username === A.username)).toBe(true);
    expect((await as(C).get('/api/search/hashtags?q=mont')).body.items.some((h: { tag: string }) => h.tag === 'montana')).toBe(true);
    expect((await as(C).get('/api/explore/featured')).status).toBe(200);
    expect((await as(C).get('/api/suggestions')).body.items.some((u: { username: string }) => u.username === A.username)).toBe(true);
  });

  it('perfil: edición propia, avatar procesado y servido; no se puede editar el de otro', async () => {
    const up = await as(A).patch('/api/me/profile').send({ displayName: 'Ana Fotógrafa', bio: 'Luz y sombra' });
    expect(up.body.profile).toMatchObject({ displayName: 'Ana Fotógrafa', bio: 'Luz y sombra' });
    expect((await as(A).patch('/api/me/profile').send({ displayName: '' })).status).toBe(400);
    const av = await as(A).post('/api/me/avatar').attach('avatar', await jpeg(500, 500, '#c4b5fd'), { filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(av.status).toBe(200);
    expect(av.body.profile.avatarUrl).toContain(`/api/media/avatar/${A.id}`);
    const img = await as(B).get(`/api/media/avatar/${A.id}`);
    expect(img.status).toBe(200);
    expect((await sharp(img.body).metadata())).toMatchObject({ format: 'webp', width: 320, height: 320 });
    expect((await as(A).post('/api/me/avatar').attach('avatar', Buffer.from('no soy imagen'), { filename: 'a.jpg' })).status).toBe(400);
    expect((await as(B).get(`/api/users/${A.username}`)).body.profile.isMe).toBe(false);
    expect((await as(B).get('/api/users/' + A.username + '/posts')).body.items.length).toBeGreaterThan(0);
  });

  it('borrar publicación: solo el autor; elimina filas y objetos de almacenamiento', async () => {
    const p = await publishReady(A, { caption: 'borrar' });
    const keys = (await pool.query('SELECT storage_key AS k FROM photos WHERE id = $1 UNION ALL SELECT storage_key FROM photo_variants WHERE photo_id = $1', [p.photo.id])).rows.map((r) => r.k);
    expect(keys).toHaveLength(6); // original + display + thumbnail + 3 transformaciones
    expect((await as(B).del(`/api/posts/${p.id}`)).status).toBe(404);
    expect((await as(A).del(`/api/posts/${p.id}`)).status).toBe(204);
    expect((await as(A).get(`/api/posts/${p.id}`)).status).toBe(404);
    for (const k of keys) expect(await getStorage().exists(k)).toBe(false);
  });

  it('seguridad: sin sesión 401, CSRF por Origin, rutas desconocidas 404', async () => {
    for (const url of ['/api/feed', '/api/explore', '/api/me/saved', `/api/posts/${post.id}`, `/api/users/${A.username}`, '/api/suggestions']) {
      expect((await request(app).get(url)).status, url).toBe(401);
    }
    expect((await request(app).post(`/api/posts/${post.id}/like`).set('Origin', 'https://evil.example').set('Cookie', B.cookie)).status).toBe(403);
    expect((await request(app).post(`/api/posts/${post.id}/like`).set('Cookie', B.cookie)).status).toBe(403);
    expect((await request(app).get('/api/nada')).status).toBe(404);
  });
});
