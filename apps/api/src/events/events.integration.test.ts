// Integración REAL del sistema SSE: servidor HTTP verdadero + PostgreSQL LISTEN/NOTIFY + sesiones reales.
// Usuarios: A = autora, B = seguidor autorizado, C = sin autorización, D = solicitud rechazada, E = conexiones/sesión, F = revocación de sesiones.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../test/helpers.js';
import { hashToken } from '../modules/auth/auth.service.js';
import { mfaRepository } from '../modules/mfa/mfa.repository.js';

const run = process.env.INTEGRATION === '1';

interface Ev { event: string; data: Record<string, unknown> }
interface Sse {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: string;
  body: string;
  events: Ev[];
  heartbeats: number;
  ended: boolean;
  close: () => void;
  find: (event: string, postId?: string) => Ev[];
  waitFor: (pred: (e: Ev) => boolean, ms?: number) => Promise<Ev>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cookieHeader = (c: string[]) => c.map((x) => x.split(';')[0]).join('; ');

function openSse(port: number, cookie: string[]): Promise<Sse> {
  return new Promise((resolve, reject) => {
    let req: http.ClientRequest;
    const s: Sse = {
      status: 0, headers: {}, raw: '', body: '', events: [], heartbeats: 0, ended: false,
      close: () => req.destroy(),
      find: (event, postId) => s.events.filter((e) => e.event === event && (postId === undefined || e.data.postId === postId)),
      waitFor: async (pred, ms = 4000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const hit = s.events.find(pred);
          if (hit) return hit;
          await sleep(20);
        }
        throw new Error(`Tiempo agotado esperando evento; recibidos: ${JSON.stringify(s.events.map((e) => [e.event, e.data.type ?? e.data.action]))}`);
      },
    };
    req = http.request({ port, path: '/api/events', headers: { Cookie: cookieHeader(cookie), Accept: 'text/event-stream' } }, (res) => {
      s.status = res.statusCode ?? 0;
      s.headers = res.headers;
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk: string) => {
        s.raw += chunk;
        if (s.status !== 200) { s.body += chunk; return; }
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const lines = block.split('\n');
          if (lines.every((l) => l.startsWith(':'))) { s.heartbeats++; continue; }
          const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
          const data = lines.find((l) => l.startsWith('data: '))?.slice(6);
          if (event && data) s.events.push({ event, data: JSON.parse(data) as Record<string, unknown> });
        }
      });
      res.on('end', () => { s.ended = true; });
      res.on('close', () => { s.ended = true; });
      resolve(s);
    });
    req.on('error', (e) => { if (s.status === 0) reject(e); else s.ended = true; });
    req.end();
  });
}

describe.skipIf(!run)('SSE: eventos en tiempo real, privacidad y estabilidad', async () => {
  const { createApp } = await import('../app.js');
  const { pool } = await import('../db/pool.js');
  const hub = await import('./hub.js');
  const app = createApp({ mailer: { send: async () => undefined } });
  const server = http.createServer(app);
  let port = 0;

  const tag = `${Date.now().toString(36)}s`;
  const pw = 'Clave-segura-123';
  const mk = (k: string) => ({ k, username: `s${k}_${tag}`, email: `s${k}_${tag}@example.com`, cookie: [] as string[], id: '' });
  const [A, B, C, D, E, F] = ['a', 'b', 'c', 'd', 'e', 'f'].map(mk) as [ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>, ReturnType<typeof mk>];
  type U = typeof A;
  const as = (u: U) => ({
    get: (url: string) => request(app).get(url).set('Cookie', u.cookie),
    post: (url: string) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
    patch: (url: string) => request(app).patch(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
    delete: (url: string) => request(app).delete(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
  });
  const open = (u: U) => openSse(port, u.cookie);
  const opened: Sse[] = [];
  const connect = async (u: U) => {
    const s = await openSse(port, u.cookie);
    opened.push(s);
    if (s.status === 200) await s.waitFor((e) => e.event === 'ready');
    return s;
  };
  const settle = () => sleep(300);
  /** Espera a que el número de conexiones se estabilice (las limpiezas de pruebas anteriores son asíncronas). */
  const quiet = async () => {
    let last = -1;
    while (hub.connectedCount() !== last) { last = hub.connectedCount(); await sleep(300); }
  };

  /** Publicación «completa» en una sola transacción (variantes y rostros resueltos) para que ningún reconciliador la reprocese. */
  async function mkPost(author: U, visibility: 'public' | 'followers' | 'private' = 'public'): Promise<string> {
    const id = randomUUID();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('INSERT INTO posts(id, author_id, caption, visibility) VALUES ($1,$2,$3,$4)', [id, author.id, 'Texto-privado-SECRETO #sal', visibility]);
      const photoId = (await c.query<{ id: string }>("INSERT INTO photos(post_id, storage_provider, bucket, storage_key, mime, width, height, bytes, sha256, status, faces_status, sanitized) VALUES ($1,'s3','test',$2,'image/jpeg',10,10,1,$3,'ready','done',true) RETURNING id", [id, `test/${id}`, 'a'.repeat(64)])).rows[0]!.id;
      for (const kind of ['display', 'thumbnail', 'bw_editorial', 'sepia_cinema', 'lumen_tone']) {
        await c.query("INSERT INTO photo_variants(photo_id, kind, bucket, storage_key, mime, width, height, bytes, params) VALUES ($1,$2::variant_kind,'test',$3,'image/webp',10,10,1,'{}')", [photoId, kind, `test/${id}/${kind}`]);
      }
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    return id;
  }
  const announce = (author: U, postId: string, visibility: 'public' | 'followers' | 'private') =>
    hub.publish({ kind: 'post', action: 'created', postId, authorId: author.id, authorUsername: author.username, visibility });

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    for (const u of [A, B, C, D, E, F]) {
      const r = await request(app).post('/api/auth/register').set('Origin', ORIGIN).send({ displayName: `Usuario ${u.k}`, username: u.username, email: u.email, password: pw, confirmPassword: pw });
      u.cookie = r.headers['set-cookie'] as unknown as string[];
      u.id = r.body.user.id;
    }
    hub.startEventListener();
    // Espera a que el oyente LISTEN esté activo (sonda real: se reintenta hasta que llegue)
    const probe = await openSse(port, A.cookie);
    opened.push(probe);
    for (let i = 0; i < 40 && !probe.find('notification').some((e) => e.data.type === 'probe'); i++) {
      await hub.publish({ kind: 'notification', userId: A.id, id: randomUUID(), type: 'probe', actor: null, postId: null });
      await sleep(150);
    }
    expect(probe.find('notification').some((e) => e.data.type === 'probe')).toBe(true);
    probe.close();
  });

  afterAll(async () => {
    for (const s of opened) s.close();
    await hub.stopEventListener();
    await new Promise<void>((r) => server.close(() => r()));
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`s%_${tag}@example.com`]);
    await pool.end();
  });

  // ================= Conexión, autenticación y estabilidad =================
  describe('Conexión y estabilidad', () => {
    it('S01 sin sesión: 401 y ningún flujo', async () => {
      const s = await openSse(port, []);
      opened.push(s);
      expect(s.status).toBe(401);
      expect(s.headers['content-type']).not.toMatch(/event-stream/);
      expect(s.events).toHaveLength(0);
    });

    it('S02 con sesión: cabeceras SSE, retry y evento ready', async () => {
      const s = await connect(A);
      expect(s.status).toBe(200);
      expect(s.headers['content-type']).toMatch(/text\/event-stream/);
      expect(s.headers['cache-control']).toMatch(/no-cache/);
      expect(s.headers['x-accel-buffering']).toBe('no');
      expect(s.raw).toContain('retry: 4000');
      s.close();
    });

    it('S03 cookie de sesión inválida: 401', async () => {
      const s = await openSse(port, ['lz_session=token-falso-no-existe']);
      opened.push(s);
      expect(s.status).toBe(401);
    });

    it('S04 heartbeat: llega un comentario de latido pasados ~25 s', async () => {
      const s = await connect(B);
      await sleep(26_000);
      expect(s.heartbeats).toBeGreaterThanOrEqual(1);
      s.close();
    }, 40_000);

    it('S05 desconexión inesperada libera la conexión y el temporizador', async () => {
      (await connect(E)).close(); // ciclo de calentamiento: los temporizadores de fondo de Node/Express se crean con la primera petición
      await quiet();
      await sleep(300);
      const base = hub.connectedCount();
      const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
      const t0 = timers();
      const s = await connect(E);
      expect(hub.connectedCount()).toBe(base + 1);
      s.close(); // corte brusco del socket
      for (let i = 0; i < 50 && hub.connectedCount() !== base; i++) await sleep(50);
      expect(hub.connectedCount()).toBe(base);
      await sleep(100);
      expect(timers()).toBeLessThanOrEqual(t0); // el setInterval del latido se limpió
    });

    it('S06 límite de 5 conexiones por usuario: la más antigua se cierra y no quedan temporizadores huérfanos', async () => {
      await quiet();
      const base = hub.connectedCount();
      const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
      const t0 = timers();
      const list: Sse[] = [];
      for (let i = 0; i < 6; i++) list.push(await connect(E));
      await sleep(300);
      expect(list[0]!.ended).toBe(true); // expulsada
      expect(list.slice(1).every((s) => !s.ended)).toBe(true);
      expect(hub.connectedCount()).toBe(base + 5);
      expect(timers()).toBeLessThanOrEqual(t0 + 5); // la expulsada no deja su latido vivo
      list.forEach((s) => s.close());
      for (let i = 0; i < 50 && hub.connectedCount() !== base; i++) await sleep(50);
      expect(hub.connectedCount()).toBe(base);
      await sleep(100);
      expect(timers()).toBeLessThanOrEqual(t0);
    });

    it('S07 dos pestañas del mismo usuario: cada una recibe UN solo ejemplar (sin duplicados)', async () => {
      const t1 = await connect(B);
      const t2 = await connect(B);
      const pid = randomUUID();
      await announce(A, pid, 'public');
      await t1.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await t2.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await settle();
      expect(t1.find('post', pid)).toHaveLength(1);
      expect(t2.find('post', pid)).toHaveLength(1);
      t1.close(); t2.close();
    });
  });

  // ================= Publicaciones: audiencias =================
  describe('Publicaciones y audiencia', () => {
    let a: Sse, b: Sse, c: Sse;
    beforeAll(async () => { [a, b, c] = [await connect(A), await connect(B), await connect(C)]; });

    it('E01 publicación pública (perfil público): la reciben A, B y C; el payload es mínimo', async () => {
      const pid = randomUUID();
      await announce(A, pid, 'public');
      const [ea, eb, ec] = await Promise.all([a, b, c].map((s) => s.waitFor((e) => e.event === 'post' && e.data.postId === pid)));
      expect(ea!.data).toMatchObject({ action: 'created', own: true });
      expect(eb!.data).toMatchObject({ following: false, own: false });
      expect(ec!.data).toMatchObject({ following: false, own: false });
      for (const e of [ea!, eb!, ec!]) expect(Object.keys(e.data).sort()).toEqual(['action', 'authorId', 'authorUsername', 'following', 'own', 'postId']);
      await settle();
      expect(b.find('post', pid)).toHaveLength(1); // sin duplicados
    });

    it('N13 nuevo seguidor: solo A recibe el aviso', async () => {
      const r = await as(B).post(`/api/users/${A.username}/follow`);
      expect(r.body.profile.following).toBe(true);
      const n = await a.waitFor((e) => e.event === 'notification' && e.data.type === 'follow');
      expect(n.data.actor).toMatchObject({ username: B.username });
      expect(n.data.userId).toBe(A.id);
      await settle();
      expect(b.find('notification').some((e) => e.data.type === 'follow')).toBe(false);
      expect(c.find('notification').some((e) => e.data.type === 'follow')).toBe(false);
    });

    it('E02 solo seguidores: la reciben A y B (following=true); C no', async () => {
      const pid = randomUUID();
      await announce(A, pid, 'followers');
      const eb = await b.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      expect(eb.data.following).toBe(true);
      await a.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await settle();
      expect(c.find('post', pid)).toHaveLength(0);
    });

    it('E03 privada: solo la autora la recibe', async () => {
      const pid = randomUUID();
      await announce(A, pid, 'private');
      await a.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await settle();
      expect(b.find('post', pid)).toHaveLength(0);
      expect(c.find('post', pid)).toHaveLength(0);
    });

    it('N11 / N12 me gusta y comentario: solo A recibe cada aviso; el aviso no contiene el texto del comentario', async () => {
      const pid = await mkPost(A, 'public');
      expect((await as(C).post(`/api/posts/${pid}/like`)).status).toBeLessThan(300);
      const like = await a.waitFor((e) => e.event === 'notification' && e.data.type === 'like' && e.data.postId === pid);
      expect(like.data.actor).toMatchObject({ username: C.username });
      expect((await as(B).post(`/api/posts/${pid}/comments`).send({ body: 'COMENTARIO-CONFIDENCIAL-123' })).status).toBeLessThan(300);
      const com = await a.waitFor((e) => e.event === 'notification' && e.data.type === 'comment' && e.data.postId === pid);
      await settle();
      expect(JSON.stringify(com.data)).not.toContain('COMENTARIO-CONFIDENCIAL');
      expect(Object.keys(com.data).sort()).toEqual(['actor', 'id', 'kind', 'postId', 'type', 'userId']);
      for (const s of [b, c]) expect(s.find('notification').some((e) => e.data.postId === pid)).toBe(false);
    });

    it('S08 una notificación dirigida a B nunca llega a A ni a C', async () => {
      const id = randomUUID();
      await hub.publish({ kind: 'notification', userId: B.id, id, type: 'like', actor: null, postId: null });
      await b.waitFor((e) => e.event === 'notification' && e.data.id === id);
      await settle();
      expect(a.find('notification').some((e) => e.data.id === id)).toBe(false);
      expect(c.find('notification').some((e) => e.data.id === id)).toBe(false);
    });

    it('E08 edición (pública): A, B y C reciben «updated» sin el texto editado', async () => {
      const pid = await mkPost(A, 'public');
      const r = await as(A).patch(`/api/posts/${pid}`).send({ caption: 'Nuevo-texto-EDITADO' });
      expect(r.status).toBe(200);
      for (const s of [a, b, c]) {
        const e = await s.waitFor((x) => x.event === 'post' && x.data.postId === pid && x.data.action === 'updated');
        expect(JSON.stringify(e.data)).not.toContain('EDITADO');
      }
    });

    it('E10 pública → privada: solo A recibe el evento; B y C no son avisados de la publicación privada', async () => {
      const pid = await mkPost(A, 'public');
      expect((await as(A).patch(`/api/posts/${pid}`).send({ visibility: 'private' })).status).toBe(200);
      await a.waitFor((e) => e.event === 'post' && e.data.postId === pid && e.data.action === 'updated');
      await settle();
      expect(b.find('post', pid)).toHaveLength(0);
      expect(c.find('post', pid)).toHaveLength(0);
      expect((await as(B).get(`/api/posts/${pid}`)).status).toBe(404); // y la API tampoco la entrega
    });

    it('E09 eliminación: pública llega a todos; «solo seguidores» no llega a C; la API deja de servirla', async () => {
      const pub = await mkPost(A, 'public');
      expect((await as(A).delete(`/api/posts/${pub}`)).status).toBe(204);
      for (const s of [a, b, c]) await s.waitFor((e) => e.event === 'post' && e.data.postId === pub && e.data.action === 'deleted');
      const fol = await mkPost(A, 'followers');
      expect((await as(A).delete(`/api/posts/${fol}`)).status).toBe(204);
      await b.waitFor((e) => e.event === 'post' && e.data.postId === fol && e.data.action === 'deleted');
      await settle();
      expect(c.find('post', fol)).toHaveLength(0);
      expect((await as(B).get(`/api/posts/${pub}`)).status).toBe(404);
    });

    it('E07 B deja de seguir: los siguientes «solo seguidores» ya no le llegan (sin reconectar)', async () => {
      await as(B).delete(`/api/users/${A.username}/follow`);
      const pid = randomUUID();
      await announce(A, pid, 'followers');
      await a.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await settle();
      expect(b.find('post', pid)).toHaveLength(0);
      await as(B).post(`/api/users/${A.username}/follow`); // vuelve a seguir para los siguientes escenarios
      await a.waitFor((e) => e.event === 'notification' && e.data.type === 'follow' && e.data.id !== undefined && a.find('notification').filter((x) => x.data.type === 'follow').length >= 2);
    });

    // ----- perfil privado -----
    it('E04 / N14 perfil privado: C solicita seguir → solo A recibe el aviso follow_request; C no recibe publicaciones', async () => {
      expect((await as(A).patch('/api/me/settings').send({ isPrivate: true })).body.isPrivate).toBe(true);
      const r = await as(C).post(`/api/users/${A.username}/follow`);
      expect(r.body.profile).toMatchObject({ followRequested: true, following: false });
      const n = await a.waitFor((e) => e.event === 'notification' && e.data.type === 'follow_request');
      expect(n.data.actor).toMatchObject({ username: C.username });
      await settle();
      expect(b.find('notification').some((e) => e.data.type === 'follow_request')).toBe(false);
      const pid = randomUUID();
      await announce(A, pid, 'public'); // pública, pero el perfil es privado
      await b.waitFor((e) => e.event === 'post' && e.data.postId === pid); // B ya seguía
      await settle();
      expect(c.find('post', pid)).toHaveLength(0); // E05: solicitud pendiente sin acceso
    });

    it('E06 / N15 solicitud aceptada: C recibe el aviso follow_accepted y desde ese momento recibe publicaciones', async () => {
      expect((await as(A).post(`/api/me/follow-requests/${C.username}/accept`)).status).toBe(200);
      const n = await c.waitFor((e) => e.event === 'notification' && e.data.type === 'follow_accepted');
      expect(n.data.userId).toBe(C.id);
      await settle();
      expect(b.find('notification').some((e) => e.data.type === 'follow_accepted')).toBe(false);
      const pid = randomUUID();
      await announce(A, pid, 'public');
      const e = await c.waitFor((x) => x.event === 'post' && x.data.postId === pid);
      expect(e.data.following).toBe(true);
    });

    it('E07b solicitud rechazada: D no recibe avisos de aceptación ni publicaciones', async () => {
      const d = await connect(D);
      await as(D).post(`/api/users/${A.username}/follow`);
      await a.waitFor((e) => e.event === 'notification' && e.data.type === 'follow_request' && (e.data.actor as { username: string }).username === D.username);
      expect((await as(A).post(`/api/me/follow-requests/${D.username}/decline`)).status).toBe(200);
      const pid = randomUUID();
      await announce(A, pid, 'public');
      await a.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await settle();
      expect(d.find('post', pid)).toHaveLength(0);
      expect(d.find('notification').some((e) => e.data.type === 'follow_accepted')).toBe(false);
      d.close();
    });

    it('S09 perfil privado → público acepta pendientes y la audiencia vuelve a ser abierta (sin reconectar)', async () => {
      await as(D).post(`/api/users/${A.username}/follow`);
      expect((await as(A).patch('/api/me/settings').send({ isPrivate: false })).body.isPrivate).toBe(false);
      const pid = randomUUID();
      await announce(A, pid, 'public');
      await c.waitFor((e) => e.event === 'post' && e.data.postId === pid);
    });
  });

  // ================= Reconexión y sesiones =================
  describe('Reconexión, permisos y cierre de sesión', () => {
    it('S10 reconexión: no se reenvían eventos pasados (sin Last-Event-ID ni reproducción)', async () => {
      const pid = randomUUID();
      const first = await connect(C);
      await announce(A, pid, 'public');
      await first.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      first.close();
      const again = await connect(C);
      await settle();
      expect(again.find('post', pid)).toHaveLength(0);
      expect(again.events.filter((e) => e.event !== 'ready' && e.data.postId === pid)).toHaveLength(0);
      again.close();
    });

    it('S11 reconectar con Last-Event-ID falsificado no recupera nada', async () => {
      const priv = randomUUID();
      const c = await new Promise<Sse>((resolve, reject) => {
        const s = { events: [] as Ev[], raw: '' };
        const req = http.request({ port, path: '/api/events', headers: { Cookie: cookieHeader(C.cookie), 'Last-Event-ID': '0' } }, (res) => {
          res.setEncoding('utf8');
          res.on('data', (ch: string) => { s.raw += ch; });
          setTimeout(() => { req.destroy(); resolve(s as unknown as Sse); }, 600);
        });
        req.on('error', () => undefined);
        req.on('error', reject);
        req.end();
      });
      expect(c.raw).not.toContain(priv);
      expect((c.raw.match(/event: /g) ?? []).length).toBe(1); // solo «ready»
    });

    it('S12 mensajes basura en el canal no rompen el reparto; el canal ajeno se ignora', async () => {
      const b = await connect(B);
      await pool.query("SELECT pg_notify('lumenza_events', 'esto-no-es-json')");
      await pool.query("SELECT pg_notify('lumenza_events', '{\"kind\":\"desconocido\"}')");
      await pool.query("SELECT pg_notify('otro_canal', $1)", [JSON.stringify({ kind: 'notification', userId: B.id, id: 'x', type: 'like', actor: null, postId: null })]);
      const id = randomUUID();
      await hub.publish({ kind: 'notification', userId: B.id, id, type: 'like', actor: null, postId: null });
      await b.waitFor((e) => e.event === 'notification' && e.data.id === id);
      expect(b.find('notification').some((e) => e.data.id === 'x')).toBe(false);
      b.close();
    });

    it('S13 publish tolera errores de PostgreSQL (payload > 8000 bytes) sin lanzar', async () => {
      await expect(hub.publish({ kind: 'post', action: 'created', postId: 'x'.repeat(9000), authorId: A.id, authorUsername: A.username, visibility: 'public' })).resolves.toBeUndefined();
    });

    it('S14 caída del oyente LISTEN: se reconecta solo y vuelve a repartir eventos', async () => {
      const a = await connect(A);
      const pids = (await pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE query LIKE 'LISTEN lumenza_events%' AND pid <> pg_backend_pid()")).rows;
      expect(pids.length).toBeGreaterThan(0);
      for (const { pid } of pids) await pool.query('SELECT pg_terminate_backend($1)', [pid]);
      let delivered = false;
      for (let i = 0; i < 40 && !delivered; i++) {
        const id = randomUUID();
        await hub.publish({ kind: 'notification', userId: A.id, id, type: 'like', actor: null, postId: null });
        await sleep(250);
        delivered = a.find('notification').some((e) => e.data.id === id);
      }
      expect(delivered).toBe(true);
      a.close();
    }, 30_000);

    it('S15 cambio de permisos: un seguidor que A elimina deja de recibir «solo seguidores»', async () => {
      // B sigue a A (E07 lo restableció). Se simula con C: A lo expulsa quitando la relación en BD no existe como endpoint;
      // se usa la baja voluntaria de C y se comprueba la audiencia en el siguiente evento.
      const c = await connect(C);
      const a = await connect(A);
      await as(C).delete(`/api/users/${A.username}/follow`);
      const pid = randomUUID();
      await announce(A, pid, 'followers');
      await a.waitFor((e) => e.event === 'post' && e.data.postId === pid);
      await settle();
      expect(c.find('post', pid)).toHaveLength(0);
      c.close(); a.close();
    });

    it('S16 cierre de sesión: el flujo abierto se cierra y no se siguen recibiendo avisos privados', async () => {
      const e = await connect(E);
      const out = await as(E).post('/api/auth/logout');
      expect(out.status).toBeLessThan(300);
      await as(A).patch('/api/me/settings').send({ isPrivate: false });
      const id = randomUUID();
      await hub.publish({ kind: 'notification', userId: E.id, id, type: 'like', actor: null, postId: null });
      await sleep(800);
      const leaked = e.find('notification').some((x) => x.data.id === id);
      expect({ cerrado: e.ended, avisoRecibidoTrasLogout: leaked }).toEqual({ cerrado: true, avisoRecibidoTrasLogout: false });
      e.close();
    });

    it('S17 sesión revocada: no se puede abrir un flujo nuevo con la cookie anterior', async () => {
      const s = await openSse(port, E.cookie);
      opened.push(s);
      expect(s.status).toBe(401);
    });
  });

  // ================= Revocación de sesiones (corrección de S16) =================
  describe('Revocación de sesiones', () => {
    // Cookie firmada «s:<token>.<firma>»: el hash de sesión se calcula sobre el token (como hace loadUser).
    const sessionCookie = (c: string[]) => c.map((x) => x.split(';')[0]).find((x) => x!.startsWith('lz_session='))!.slice('lz_session='.length);
    const hashOf = (cookie: string[]) => hashToken(decodeURIComponent(sessionCookie(cookie)).replace(/^s:/, '').split('.')[0]!);
    const login = async (u: U) => {
      const r = await request(app).post('/api/auth/login').set('Origin', ORIGIN).send({ identifier: u.email, password: pw });
      expect(r.status).toBe(200);
      return r.headers['set-cookie'] as unknown as string[];
    };
    const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
    const notif = (userId: string) => hub.publish({ kind: 'notification', userId, id: randomUUID(), type: 'like', actor: null, postId: null });

    it('S18 varias conexiones de la misma sesión se cierran juntas; otra sesión del mismo usuario sigue viva', async () => {
      const second = await login(F);
      const s1 = [await openSse(port, F.cookie), await openSse(port, F.cookie), await openSse(port, F.cookie)];
      const s2 = await openSse(port, second);
      opened.push(...s1, s2);
      await Promise.all([...s1, s2].map((s) => s.waitFor((e) => e.event === 'ready')));
      expect((await as(F).post('/api/auth/logout')).status).toBeLessThan(300);
      await sleep(200);
      expect(s1.map((s) => s.ended)).toEqual([true, true, true]);
      expect(s2.ended).toBe(false);
      const id = randomUUID();
      await hub.publish({ kind: 'notification', userId: F.id, id, type: 'like', actor: null, postId: null });
      await s2.waitFor((e) => e.event === 'notification' && e.data.id === id); // la otra sesión sigue recibiendo
      expect(s1.some((s) => s.find('notification').some((e) => e.data.id === id))).toBe(false);
      s2.close();
      F.cookie = second; // F continúa con la sesión que quedó viva
    });

    it('S19 limpieza tras el cierre: sin conexiones y sin temporizador del hub', async () => {
      opened.forEach((s) => s.close()); // cierra también los flujos que dejaron abiertos los bloques anteriores
      await quiet();
      await sleep(300);
      expect(hub.connectedCount()).toBe(0);
      expect(hub.tickerActive()).toBe(false); // sin conexiones no hay temporizador
      const s = await connect(F);
      expect(hub.tickerActive()).toBe(true); // el hub activa su único temporizador al haber conexiones
      s.close();
      await quiet();
      await sleep(300);
      expect(hub.connectedCount()).toBe(0);
      expect(hub.tickerActive()).toBe(false); // y lo libera al quedar vacío
    });

    it('S20 concurrencia logout ↔ publicación: nada se escribe tras confirmar el cierre de sesión', async () => {
      const cookie = await login(F);
      const s = await connect({ ...F, cookie });
      let publishing = true;
      const storm = (async () => { while (publishing) { await Promise.all(Array.from({ length: 10 }, () => notif(F.id))); } })();
      await sleep(150);
      expect((await request(app).post('/api/auth/logout').set('Origin', ORIGIN).set('Cookie', cookie)).status).toBeLessThan(300);
      await sleep(100); // deja drenar lo que ya iba en el socket
      const seen = s.events.length + s.heartbeats;
      await sleep(700); // la tormenta de publicaciones continúa
      publishing = false;
      await storm;
      expect(s.ended).toBe(true);
      expect(s.events.length + s.heartbeats).toBe(seen); // ningún evento posterior al cierre confirmado
    });

    it('S21 expiración natural: una sesión caducada se cierra en la revalidación', async () => {
      const cookie = await login(F);
      const s = await connect({ ...F, cookie });
      await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hashOf(cookie)]);
      await hub.maintain();
      await sleep(150);
      expect(s.ended).toBe(true);
      const id = randomUUID();
      await hub.publish({ kind: 'notification', userId: F.id, id, type: 'like', actor: null, postId: null });
      await sleep(400);
      expect(s.find('notification').some((e) => e.data.id === id)).toBe(false);
      const again = await openSse(port, cookie);
      opened.push(again);
      expect(again.status).toBe(401);
    });

    it('S22 revocación por otra vía (BD directa): el temporizador del hub la detecta solo, sin llamar al hub', async () => {
      const cookie = await login(F);
      const s = await connect({ ...F, cookie });
      await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1', [hashOf(cookie)]);
      expect(s.ended).toBe(false); // nadie avisó al hub
      for (let i = 0; i < 60 && !s.ended; i++) await sleep(500); // el ciclo natural es de 25 s
      expect(s.ended).toBe(true);
    }, 45_000);

    it('S23 revocar «las demás sesiones» (activar MFA) cierra sus flujos y conserva la sesión actual', async () => {
      const keep = await login(F);
      const other = await login(F);
      const sKeep = await connect({ ...F, cookie: keep });
      const sOther = await connect({ ...F, cookie: other });
      await mfaRepository.revokeOtherSessions(F.id, hashOf(keep));
      await sleep(200);
      expect(sOther.ended).toBe(true);
      expect(sKeep.ended).toBe(false);
      const id = randomUUID();
      await hub.publish({ kind: 'notification', userId: F.id, id, type: 'like', actor: null, postId: null });
      await sKeep.waitFor((e) => e.event === 'notification' && e.data.id === id);
      sKeep.close();
    });

    it('S24 el flujo no expone cookies, hashes ni tokens de sesión', async () => {
      const cookie = await login(F);
      const s = await connect({ ...F, cookie });
      await hub.publish({ kind: 'notification', userId: F.id, id: randomUUID(), type: 'like', actor: null, postId: null });
      await sleep(300);
      expect(s.raw).not.toContain(hashOf(cookie));
      expect(s.raw).not.toContain(sessionCookie(cookie).slice(0, 20));
      s.close();
    });
  });
});
