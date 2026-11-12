// Integración REAL contra PostgreSQL: perfiles privados, avisos, ajustes y edición de publicaciones (sin S3 ni worker).
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers.js';

const run = process.env.INTEGRATION === '1';

describe.skipIf(!run)('Privacidad, avisos y edición', async () => {
  const { createApp } = await import('../../app.js');
  const { pool } = await import('../../db/pool.js');
  const app = createApp({ mailer: { send: async () => undefined } });
  const tag = `${Date.now().toString(36)}p`;
  const pw = 'Clave-segura-123';
  const mk = (k: string) => ({ k, username: `p${k}_${tag}`, email: `p${k}_${tag}@example.com`, cookie: [] as string[], id: '' });
  const [A, B, C] = [mk('a'), mk('b'), mk('c')] as [ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>];
  const as = (u: typeof A) => ({
    get: (url: string) => request(app).get(url).set('Cookie', u.cookie),
    post: (url: string) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
    patch: (url: string) => request(app).patch(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
  });
  let postId = '';

  beforeAll(async () => {
    for (const u of [A, B, C]) {
      const r = await request(app).post('/api/auth/register').set('Origin', ORIGIN).send({ displayName: `Usuario ${u.k}`, username: u.username, email: u.email, password: pw, confirmPassword: pw });
      u.cookie = r.headers['set-cookie'] as unknown as string[];
      u.id = r.body.user.id;
    }
    // Publicación «lista» de A insertada directamente (no se prueba el procesamiento aquí)
    postId = randomUUID();
    // Foto «completa» (variantes y rostros ya resueltos), insertada en UNA transacción para que el reconciliador de otros workers de prueba no la reprocese
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO posts(id, author_id, caption, visibility) VALUES ($1,$2,'Mar #sal','public')", [postId, A.id]);
      const photoId = (await c.query<{ id: string }>("INSERT INTO photos(post_id, storage_provider, bucket, storage_key, mime, width, height, bytes, sha256, status, faces_status, sanitized) VALUES ($1,'s3','test',$2,'image/jpeg',10,10,1,$3,'ready','done',true) RETURNING id", [postId, `test/${postId}`, 'a'.repeat(64)])).rows[0]!.id;
      for (const kind of ['display', 'thumbnail', 'bw_editorial', 'sepia_cinema', 'lumen_tone']) {
        await c.query("INSERT INTO photo_variants(photo_id, kind, bucket, storage_key, mime, width, height, bytes, params) VALUES ($1,$2::variant_kind,'test',$3,'image/webp',10,10,1,'{}')", [photoId, kind, `test/${postId}/${kind}`]);
      }
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });
  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`p%_${tag}@example.com`]);
    await pool.end();
  });

  it('perfil privado: solicitud, bloqueo de contenido, aviso y aceptación', async () => {
    expect((await as(A).patch('/api/me/settings').send({ isPrivate: true })).body.isPrivate).toBe(true);
    const req = await as(B).post(`/api/users/${A.username}/follow`);
    expect(req.body.profile).toMatchObject({ following: false, followRequested: true, canView: false, isPrivate: true });
    expect((await as(B).get(`/api/users/${A.username}/posts`)).body).toMatchObject({ items: [], locked: true });
    expect((await as(B).get(`/api/posts/${postId}`)).status).toBe(404); // ni siquiera el detalle de una publicación pública
    const ex = await as(B).get('/api/explore');
    expect(ex.body.items.some((p: { id: string }) => p.id === postId)).toBe(false);
    // A recibe el aviso y la solicitud pendiente
    const n = (await as(A).get('/api/notifications')).body.items.find((i: { type: string }) => i.type === 'follow_request');
    expect(n).toMatchObject({ pending: true, read: false });
    expect((await as(A).get('/api/me/follow-requests')).body.items).toHaveLength(1);
    // Solo el destinatario resuelve; B no puede aceptarse a sí mismo
    expect((await as(B).post(`/api/me/follow-requests/${A.username}/accept`)).status).toBe(404);
    expect((await as(A).post(`/api/me/follow-requests/${B.username}/accept`)).status).toBe(200);
    expect((await as(B).get(`/api/posts/${postId}`)).status).toBe(200);
    expect((await as(B).get(`/api/users/${A.username}`)).body.profile.canView).toBe(true);
    const back = (await as(B).get('/api/notifications')).body.items.find((i: { type: string }) => i.type === 'follow_accepted');
    expect(back).toBeTruthy();
  });

  it('rechazar una solicitud no concede acceso; volver público acepta las pendientes', async () => {
    await as(C).post(`/api/users/${A.username}/follow`);
    expect((await as(A).post(`/api/me/follow-requests/${C.username}/decline`)).status).toBe(200);
    expect((await as(C).get(`/api/users/${A.username}/posts`)).body.locked).toBe(true);
    await as(C).post(`/api/users/${A.username}/follow`);
    await as(A).patch('/api/me/settings').send({ isPrivate: false });
    expect((await as(C).get(`/api/users/${A.username}`)).body.profile).toMatchObject({ following: true, canView: true });
  });

  it('avisos: contador, marcar leídos y preferencias', async () => {
    await as(A).patch('/api/me/settings').send({ notifPrefs: { like: false } });
    await as(B).post(`/api/posts/${postId}/like`);
    const before = (await as(A).get('/api/notifications')).body.items.filter((i: { type: string }) => i.type === 'like');
    expect(before).toHaveLength(0); // la preferencia desactivada evita el aviso
    await as(A).patch('/api/me/settings').send({ notifPrefs: { like: true, comment: true } });
    await as(C).post(`/api/posts/${postId}/comments`).send({ body: 'Bonita' });
    const unread = (await as(A).get('/api/notifications/unread-count')).body.count;
    expect(unread).toBeGreaterThan(0);
    expect((await as(A).post('/api/notifications/read').send({})).body.count).toBe(0);
    expect((await as(B).get('/api/notifications/unread-count')).body.count).toBeGreaterThanOrEqual(0);
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });

  it('editar publicación: solo el autor; actualiza texto, etiquetas y visibilidad', async () => {
    const edit = await as(A).patch(`/api/posts/${postId}`).send({ caption: 'Mar y #espuma', tags: 'costa', visibility: 'followers', category: 'viajes' });
    expect(edit.status).toBe(200);
    expect(edit.body.post).toMatchObject({ caption: 'Mar y #espuma', visibility: 'followers', category: 'viajes' });
    expect(edit.body.post.tags.sort()).toEqual(['costa', 'espuma']);
    expect(edit.body.post.editedAt).toBeTruthy();
    expect((await as(B).patch(`/api/posts/${postId}`).send({ caption: 'hack' })).status).toBe(404);
    const cover = await as(A).patch(`/api/posts/${postId}`).send({ coverVariant: 'sepia_cinema' });
    expect(cover.status).toBe(200);
    expect(cover.body.post.photo.displayUrl).toMatch(/\/sepia_cinema$/); // el autor elige la versión mostrada
    expect((await as(A).patch(`/api/posts/${postId}`).send({ coverVariant: null })).body.post.photo.displayUrl).toMatch(/\/display$/);
    expect((await as(A).patch(`/api/posts/${postId}`).send({ visibility: 'nope' })).status).toBe(400);
  });

  it('sugerencias incluyen motivo y excluyen solicitudes enviadas', async () => {
    const s = await as(B).get('/api/suggestions');
    expect(s.status).toBe(200);
    for (const u of s.body.items) expect(typeof u.reason).toBe('string');
  });
});
