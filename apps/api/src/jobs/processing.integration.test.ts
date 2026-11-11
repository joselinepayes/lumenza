// Integración REAL del pipeline: API → PostgreSQL → cola pg-boss → worker → Sharp → RustFS (S3). Sin simulaciones de Sharp ni de almacenamiento
// (los fallos se inyectan envolviendo el StorageService real o con un procesador colgado para simular un worker caído).
process.env.PHOTO_QUEUE = 'process-photo-it-proc'; // cola aislada del worker de desarrollo

import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../test/helpers.js';
import type { StorageService } from '../storage/storage.service.js';

const run = process.env.INTEGRATION === '1';

/** Escena con cielo, montañas, agua y colores saturados: permite medir diferencias de color entre variantes. */
const scene = (w: number, h: number, orientation?: number) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27408b"/><stop offset=".6" stop-color="#e0805a"/><stop offset="1" stop-color="#f6d28b"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#s)"/><path d="M0 ${h * 0.62} L${w * 0.3} ${h * 0.35} L${w * 0.55} ${h * 0.6} L${w * 0.8} ${h * 0.4} L${w} ${h * 0.62}Z" fill="#2b2144"/>
  <rect y="${h * 0.62}" width="100%" height="${h * 0.38}" fill="#2f6f8f"/><rect x="${w * 0.1}" y="${h * 0.72}" width="${w * 0.12}" height="${h * 0.18}" fill="#b0323c"/><rect x="${w * 0.3}" y="${h * 0.75}" width="${w * 0.1}" height="${h * 0.15}" fill="#3a9d5d"/></svg>`;
  let p = sharp(Buffer.from(svg)).jpeg({ quality: 90 });
  if (orientation) p = p.withMetadata({ orientation });
  return p.toBuffer();
};
const means = async (buf: Buffer) => {
  const s = await sharp(buf).removeAlpha().stats();
  return s.channels.map((c) => c.mean) as [number, number, number];
};
const tiny = async (buf: Buffer) => sharp(buf).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
const mad = (a: Buffer, b: Buffer) => a.reduce((acc, v, i) => acc + Math.abs(v - b[i]!), 0) / a.length;

describe.skipIf(!run)('Pipeline de procesamiento (cola + worker + Sharp + S3)', async () => {
  const { createApp } = await import('../app.js');
  const { pool } = await import('../db/pool.js');
  const { getStorage } = await import('../storage/index.js');
  const { startWorker } = await import('./worker-core.js');
  const { allObjectKeys } = await import('./photo-keys.js');
  const app = createApp({ mailer: { send: async () => undefined } });
  const storage = getStorage();
  const tag = `${Date.now().toString(36)}p`;
  const pw = 'Clave-segura-123';
  const U = ['a', 'b'].map((k) => ({ k, username: `p${k}_${tag}`, email: `p${k}_${tag}@example.com`, cookie: [] as string[], id: '' }));
  const [A, B] = U as [(typeof U)[0], (typeof U)[0]];
  const as = (u: typeof A) => ({
    get: (url: string) => request(app).get(url).set('Cookie', u.cookie),
    post: (url: string) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
    del: (url: string) => request(app).delete(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
  });
  const publish = (u: typeof A, img: Buffer, fields: Record<string, string> = {}) => {
    let r = as(u).post('/api/posts').attach('photo', img, { filename: 'foto.jpg', contentType: 'image/jpeg' });
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  };
  const poll = async (u: typeof A, id: string, until: (p: any) => boolean, ms = 90_000) => {
    const t0 = Date.now();
    for (;;) {
      const r = await as(u).get(`/api/posts/${id}`);
      if (r.body.post && until(r.body.post)) return r.body.post;
      if (Date.now() - t0 > ms) throw new Error(`Tiempo agotado; último estado: ${JSON.stringify(r.body.post?.processing)}`);
      await new Promise((r2) => setTimeout(r2, 200));
    }
  };
  const ready = (u: typeof A, id: string) => poll(u, id, (p) => p.processing.status === 'ready');
  const photoRow = async (postId: string) => (await pool.query('SELECT * FROM photos WHERE post_id = $1', [postId])).rows[0];
  const objectsLeft = async (authorId: string, postId: string) => {
    const left: string[] = [];
    for (const k of allObjectKeys(authorId, postId)) if (await storage.exists(k)) left.push(k);
    return left;
  };
  const stopQueueJobs = () => pool.query('DELETE FROM pgboss.job WHERE name = $1', [process.env.PHOTO_QUEUE]);
  const workers: { stop: (o?: { graceful?: boolean }) => Promise<void> }[] = [];
  const spawn = async (o: Parameters<typeof startWorker>[0]) => { const w = await startWorker(o); workers.push(w); return w; };
  afterEach(async () => {
    for (const w of workers.splice(0)) await w.stop({ graceful: false }).catch(() => undefined);
    await stopQueueJobs();
  });

  beforeAll(async () => {
    await stopQueueJobs();
    for (const u of U) {
      const r = await request(app).post('/api/auth/register').set('Origin', ORIGIN).send({ displayName: `Proc ${u.k}`, username: u.username, email: u.email, password: pw, confirmPassword: pw });
      u.cookie = r.headers['set-cookie'] as unknown as string[];
      u.id = r.body.user.id;
    }
  });
  afterAll(async () => {
    for (const u of U) {
      const rows = (await pool.query('SELECT p.id FROM posts p WHERE p.author_id = $1', [u.id])).rows;
      for (const r of rows) for (const k of allObjectKeys(u.id, r.id)) await storage.delete(k).catch(() => undefined);
    }
    await stopQueueJobs();
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`p%_${tag}%`]);
    await pool.end();
  });

  it('genera miniatura, visualización y 3 transformaciones REALES; conserva el original; guarda en S3 y metadatos en PostgreSQL', async () => {
    const w = await spawn({ workerId: 'it-proc-main', concurrency: 1 });
    const src = await sharp(await scene(2400, 1600)).withExif({ IFD0: { Copyright: 'Dato-privado-en-EXIF' } }).jpeg({ quality: 90 }).toBuffer();
    expect((await sharp(src).metadata()).exif).toBeDefined(); // el archivo subido SÍ trae EXIF
    const res = await publish(A, src, { caption: 'Pipeline', visibility: 'public', allowDownload: 'true' });
    expect(res.status).toBe(202);
    expect(res.body.post.processing.status).toMatch(/pending|processing/);
    const post = await poll(A, res.body.post.id, (p) => p.processing.status === 'ready');

    // PostgreSQL: metadatos y estado
    const row = await photoRow(post.id);
    expect(row).toMatchObject({ status: 'ready', progress: 100, sanitized: true, processed_by: w.id });
    expect(row.processing_finished_at).toBeTruthy();
    const vars = (await pool.query('SELECT kind::text AS kind, storage_key, width, height, bytes, params FROM photo_variants WHERE photo_id = $1', [row.id])).rows;
    expect(vars.map((v) => v.kind).sort()).toEqual(['bw_editorial', 'display', 'lumen_tone', 'sepia_cinema', 'thumbnail']);
    for (const v of vars) {
      expect(await storage.exists(v.storage_key)).toBe(true); // RustFS
      expect(Number(v.bytes)).toBeGreaterThan(1000);
    }
    expect(vars.find((v) => v.kind === 'bw_editorial').params.recipe).toBe('bw-editorial@1');
    expect(post.variants.map((v: { kind: string }) => v.kind).sort()).toEqual(['bw_editorial', 'display', 'lumen_tone', 'sepia_cinema', 'thumbnail']);

    // Descargar y analizar cada variante: dimensiones, proporciones y color
    const get = async (kind: string) => (await as(A).get(`/api/media/photo/${row.id}/${kind}`)).body as Buffer;
    const b: Record<string, Buffer> = {};
    for (const k of ['display', 'thumbnail', 'bw_editorial', 'sepia_cinema', 'lumen_tone']) {
      b[k] = await get(k);
      const m = await sharp(b[k]).metadata();
      expect(m.format).toBe('webp');
      expect(Math.abs(m.width! / m.height! - 2400 / 1600)).toBeLessThan(0.01); // proporción conservada
      expect(Math.max(m.width!, m.height!)).toBeLessThanOrEqual(k === 'display' ? 1440 : k === 'thumbnail' ? 640 : 1800);
    }
    const [oR, oG, oB] = await means(src);
    const [bwR, bwG, bwB] = await means(b.bw_editorial!);
    expect(Math.abs(bwR - bwG)).toBeLessThan(3);
    expect(Math.abs(bwG - bwB)).toBeLessThan(3); // blanco y negro real (canales iguales)
    const [sR, sG, sB] = await means(b.sepia_cinema!);
    expect(sR).toBeGreaterThan(sG);
    expect(sG).toBeGreaterThan(sB);
    expect(sR - sB).toBeGreaterThan(25); // tratamiento cálido real
    const [lR, , lB] = await means(b.lumen_tone!);
    expect(lB - oB).toBeGreaterThan(3); // desplazamiento hacia el violeta/azul de marca
    expect(lR).toBeGreaterThan(0);
    void oR; void oG;
    // Las tres son visualmente distintas entre sí y del original
    const T = { original: await tiny(src), bw: await tiny(b.bw_editorial!), sepia: await tiny(b.sepia_cinema!), lumen: await tiny(b.lumen_tone!) };
    const names = Object.keys(T) as (keyof typeof T)[];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expect(mad(T[names[i]!], T[names[j]!]), `${names[i]} vs ${names[j]}`).toBeGreaterThan(6);

    // Original conservado: sin filtros, sin EXIF, mismas dimensiones y hash consistente
    const stored = (await storage.get(row.storage_key)).body;
    const om = await sharp(stored).metadata();
    expect(om).toMatchObject({ format: 'jpeg', width: 2400, height: 1600 });
    expect(om.exif).toBeUndefined();
    expect(row.sha256).toBe((await import('node:crypto')).createHash('sha256').update(stored).digest('hex'));
    const [sm0] = await means(stored);
    expect(Math.abs(sm0 - oR)).toBeLessThan(3); // el original conserva el color de la fuente
    // El autor descarga el original (permiso activo)
    expect((await as(B).get(`/api/media/photo/${row.id}/original?download=1`)).headers['content-disposition']).toContain('attachment');
  });

  it('auto-orienta con EXIF: la imagen 1000×600 con orientación 6 queda 600×1000 en todas las variantes', async () => {
    await spawn({ workerId: 'it-proc-orient' });
    const res = await publish(A, await scene(1000, 600, 6));
    expect(res.status).toBe(202);
    expect(res.body.post.photo).toMatchObject({ width: 600, height: 1000 }); // ya orientada en el registro
    const post = await ready(A, res.body.post.id);
    expect(post.photo).toMatchObject({ width: 600, height: 1000 });
    for (const v of post.variants) expect(v.height).toBeGreaterThan(v.width);
  });

  it('maneja imágenes grandes (35 MP): worker responde y las variantes quedan acotadas; >60 MP se rechaza en la petición', async () => {
    await spawn({ workerId: 'it-proc-big' });
    const big = await sharp({ create: { width: 7000, height: 5000, channels: 3, background: '#3b5b8f' } }).jpeg({ quality: 70 }).toBuffer();
    const t0 = Date.now();
    const res = await publish(A, big);
    expect(res.status).toBe(202);
    expect(Date.now() - t0).toBeLessThan(8000); // la petición HTTP NO espera al procesamiento pesado
    const post = await ready(A, res.body.post.id);
    expect(post.photo).toMatchObject({ width: 7000, height: 5000 });
    for (const v of post.variants) expect(Math.max(v.width, v.height)).toBeLessThanOrEqual(1800);
    const tooBig = await sharp({ create: { width: 9000, height: 7000, channels: 3, background: '#000' } }).jpeg({ quality: 40 }).toBuffer();
    const rej = await publish(A, tooBig);
    expect(rej.status).toBe(400);
    expect(rej.body.error.code).toBe('image_too_large');
  });

  it('rechaza archivos inválidos en la petición y marca «failed» (sin reintentos) las imágenes corruptas; el autor puede reintentar', async () => {
    await spawn({ workerId: 'it-proc-corrupt' });
    expect((await publish(A, Buffer.from('no soy una imagen'))).body.error.code).toBe('invalid_image');
    const good = await scene(900, 600);
    const truncated = good.subarray(0, Math.floor(good.length * 0.55)); // cabecera válida, datos truncados
    const res = await publish(A, truncated);
    expect(res.status).toBe(202); // la cabecera pasa la validación rápida
    const post = await poll(A, res.body.post.id, (p) => p.processing.status === 'failed');
    expect(post.processing.error).toMatch(/dañada|decodificar/i);
    expect(post.processing.attempts).toBe(1); // error permanente: no se gastan reintentos
    const reNon = await as(B).post(`/api/posts/${post.id}/reprocess`);
    expect(reNon.status).toBe(404); // solo el autor
    const re = await as(A).post(`/api/posts/${post.id}/reprocess`);
    expect(re.status).toBe(202);
    expect((await poll(A, post.id, (p) => p.processing.status === 'failed' && p.processing.attempts === 1)).processing.status).toBe('failed');
    // una fotografía lista no necesita reprocesarse
    const ok = await publish(A, good);
    await ready(A, ok.body.post.id);
    expect((await as(A).post(`/api/posts/${ok.body.post.id}/reprocess`)).status).toBe(409);
  });

  it('reintenta ante errores transitorios del almacenamiento y reutiliza lo ya generado', async () => {
    let failures = 0;
    const puts: string[] = [];
    const flaky: StorageService = Object.create(storage, {
      put: { value: async (key: string, body: Buffer, ct: string) => { puts.push(key); if (key.endsWith('/sepia_cinema.webp') && failures < 2) { failures++; throw new Error('RustFS caído (simulado)'); } return storage.put(key, body, ct); } },
    });
    const w = await spawn({ storage: flaky, workerId: 'it-proc-flaky', tuning: { retryLimit: 3, retryDelay: 1, retryBackoff: false } });
    const res = await publish(A, await scene(900, 600));
    const post = await poll(A, res.body.post.id, (p) => p.processing.status === 'ready');
    expect(failures).toBe(2);
    const row = await photoRow(post.id);
    expect(row.attempts).toBe(3); // 2 fallos + 1 éxito
    expect(row.processed_by).toBe(w.id);
    // Idempotente: display y bw_editorial se escribieron UNA sola vez aunque hubo 3 intentos
    expect(puts.filter((k) => k.endsWith('/display.webp'))).toHaveLength(1);
    expect(puts.filter((k) => k.endsWith('/bw_editorial.webp'))).toHaveLength(1);
    expect(puts.filter((k) => k.endsWith('/sepia_cinema.webp'))).toHaveLength(3);
  });

  it('agotados los reintentos queda «partial» (display+miniatura disponibles) y el reintento manual lo completa', async () => {
    const broken: StorageService = Object.create(storage, {
      put: { value: async (key: string, body: Buffer, ct: string) => { if (/\/(bw_editorial|sepia_cinema|lumen_tone)\.webp$/.test(key)) throw new Error('fallo permanente simulado'); return storage.put(key, body, ct); } },
    });
    await spawn({ storage: broken, workerId: 'it-proc-partial', tuning: { retryLimit: 1, retryDelay: 1, retryBackoff: false } });
    const res = await publish(A, await scene(900, 600));
    const post = await poll(A, res.body.post.id, (p) => p.processing.status === 'partial');
    expect(post.variants.map((v: { kind: string }) => v.kind).sort()).toEqual(['display', 'thumbnail']);
    expect(post.processing.error).toContain('fallo permanente');
    expect((await as(A).get(`/api/media/photo/${post.photo.id}/display`)).status).toBe(200); // imagen parcial utilizable
    expect((await as(A).get(`/api/media/photo/${post.photo.id}/bw_editorial`)).status).toBe(404);
    for (const w of workers.splice(0)) await w.stop({ graceful: false });
    await stopQueueJobs();
    await spawn({ workerId: 'it-proc-repair' });
    expect((await as(A).post(`/api/posts/${post.id}/reprocess`)).status).toBe(202);
    const done = await poll(A, post.id, (p) => p.processing.status === 'ready');
    expect(done.variants).toHaveLength(5);
  });

  it('recuperación ante caída del worker: el trabajo expira y otro worker lo completa', async () => {
    const tuning = { retryLimit: 3, retryDelay: 1, retryBackoff: false, expireInSeconds: 3, superviseIntervalSeconds: 1 };
    const hung = await spawn({ workerId: 'it-proc-dead', tuning, processor: () => new Promise(() => undefined) }); // toma el trabajo y «muere»
    const res = await publish(A, await scene(900, 600));
    const photoId = res.body.post.photo.id;
    const t0 = Date.now();
    for (;;) { // espera a que el worker colgado tome el trabajo (estado active)
      const j = (await pool.query("SELECT state FROM pgboss.job WHERE name = $1 AND singleton_key = $2", [process.env.PHOTO_QUEUE, photoId])).rows[0];
      if (j?.state === 'active') break;
      if (Date.now() - t0 > 15_000) throw new Error('El worker colgado nunca tomó el trabajo');
      await new Promise((r) => setTimeout(r, 200));
    }
    await hung.stop({ graceful: false }); // caída abrupta
    workers.splice(0);
    expect((await photoRow(res.body.post.id)).status).not.toBe('ready');
    await spawn({ workerId: 'it-proc-rescuer', tuning });
    const post = await poll(A, res.body.post.id, (p) => p.processing.status === 'ready', 60_000);
    expect((await photoRow(post.id)).processed_by).toBe('it-proc-rescuer');
    const job = (await pool.query('SELECT retry_count FROM pgboss.job WHERE name = $1 AND singleton_key = $2', [process.env.PHOTO_QUEUE, photoId])).rows[0];
    expect(job.retry_count).toBeGreaterThanOrEqual(1); // fue reintentado tras la expiración
  });

  it('mientras no hay worker el trabajo espera; el resto de usuarios no ve la publicación hasta que esté lista', async () => {
    await as(B).post(`/api/users/${A.username}/follow`);
    const res = await publish(A, await scene(900, 600), { caption: 'pendiente-visible-solo-al-autor', visibility: 'public' });
    const id = res.body.post.id;
    await new Promise((r) => setTimeout(r, 1500)); // sin worker: sigue en cola
    const own = (await as(A).get(`/api/posts/${id}`)).body.post;
    expect(own.processing.status).toBe('pending');
    expect((await as(A).get(`/api/users/${A.username}/posts`)).body.items.some((p: { id: string }) => p.id === id)).toBe(true); // el autor la ve en su perfil
    expect((await as(B).get(`/api/posts/${id}`)).status).toBe(404);
    expect(JSON.stringify((await as(B).get('/api/feed')).body)).not.toContain(id);
    expect(JSON.stringify((await as(B).get('/api/explore')).body)).not.toContain(id);
    expect((await as(B).get(`/api/media/photo/${res.body.post.photo.id}/display`)).status).toBe(404);
    expect((await as(A).get(`/api/media/photo/${res.body.post.photo.id}/original`)).status).toBe(404); // el original sin sanear no se sirve
    await spawn({ workerId: 'it-proc-late' });
    await ready(A, id);
    expect(JSON.stringify((await as(B).get('/api/feed')).body)).toContain(id); // ahora sí aparece
    expect(JSON.stringify((await as(B).get('/api/explore')).body)).toContain(id);
  });

  it('eliminar durante el procesamiento: no quedan objetos (worker y API limpian) y el trabajo termina limpio', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reachedGate!: () => void;
    const reached = new Promise<void>((r) => (reachedGate = r));
    await spawn({ workerId: 'it-proc-del', hooks: { beforeVariant: async (kind) => { if (kind === 'bw_editorial') { reachedGate(); await gate; } } } });
    const res = await publish(A, await scene(900, 600));
    const postId = res.body.post.id;
    await reached; // display y miniatura ya están escritas; el worker está pausado
    expect((await objectsLeft(A.id, postId)).length).toBeGreaterThanOrEqual(3);
    expect((await as(A).del(`/api/posts/${postId}`)).status).toBe(204);
    release(); // el worker continúa y debe detectar que la publicación ya no existe
    for (let i = 0; i < 100; i++) {
      const j = (await pool.query('SELECT state FROM pgboss.job WHERE name = $1 AND singleton_key = $2', [process.env.PHOTO_QUEUE, res.body.post.photo.id])).rows[0];
      if (!j || j.state === 'completed') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 500));
    expect(await objectsLeft(A.id, postId)).toEqual([]);
    expect((await pool.query('SELECT 1 FROM photos WHERE post_id = $1', [postId])).rowCount).toBe(0);
    const j = (await pool.query('SELECT state FROM pgboss.job WHERE name = $1 AND singleton_key = $2', [process.env.PHOTO_QUEUE, res.body.post.photo.id])).rows[0];
    expect(j?.state ?? 'completed').toBe('completed');
  });

  it('privacidad: variantes de fotografías privadas/seguidores protegidas; descarga solo con permiso', async () => {
    await spawn({ workerId: 'it-proc-priv' });
    const priv = await ready(A, (await publish(A, await scene(900, 600), { visibility: 'private' })).body.post.id);
    const pub = await ready(A, (await publish(A, await scene(900, 600), { visibility: 'public', allowDownload: 'false' })).body.post.id);
    const dl = await ready(A, (await publish(A, await scene(900, 600), { visibility: 'public', allowDownload: 'true' })).body.post.id);
    for (const k of ['original', 'display', 'thumbnail', 'bw_editorial', 'sepia_cinema', 'lumen_tone']) {
      expect((await as(B).get(`/api/media/photo/${priv.photo.id}/${k}`)).status, `privada/${k}/B`).toBe(404);
      expect((await request(app).get(`/api/media/photo/${priv.photo.id}/${k}`)).status, `privada/${k}/anónimo`).toBe(401);
      expect((await as(A).get(`/api/media/photo/${priv.photo.id}/${k}`)).status, `privada/${k}/autor`).toBe(200);
    }
    // Pública sin descarga: B ve las transformaciones, no el original ni puede descargarlas
    expect((await as(B).get(`/api/media/photo/${pub.photo.id}/sepia_cinema`)).status).toBe(200);
    expect((await as(B).get(`/api/media/photo/${pub.photo.id}/original`)).status).toBe(404);
    expect((await as(B).get(`/api/media/photo/${pub.photo.id}/lumen_tone?download=1`)).status).toBe(403);
    // Pública con descarga permitida
    const ok = await as(B).get(`/api/media/photo/${dl.photo.id}/bw_editorial?download=1`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toContain('attachment');
    expect((await as(B).get(`/api/media/photo/${dl.photo.id}/original?download=1`)).status).toBe(200);
  });
});
