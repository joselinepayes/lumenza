// Integración REAL de la detección de rostros: API → cola → worker → face-api (WASM) → PostgreSQL / RustFS.
// Usa un retrato de dominio público (NASA, ver test-fixtures/LICENSE.md). La detección NO está simulada, salvo el caso explícito
// de «detector que falla», que inyecta un error para probar la degradación.
process.env.PHOTO_QUEUE = 'process-photo-it-faces';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../test/helpers.js';

const run = process.env.INTEGRATION === '1';
const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-fixtures/astronaut.png');
// Anotación manual del rostro en el retrato original de 512×512 (frente–mentón), independiente del detector.
const FACE_512 = { x: 177, y: 66, w: 91, h: 114 };

type Box = { x: number; y: number; w: number; h: number };
const iou = (a: Box, b: Box) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter);
};
const place = (scale: number, left: number, top: number): Box => ({ x: left + FACE_512.x * scale, y: top + FACE_512.y * scale, w: FACE_512.w * scale, h: FACE_512.h * scale });

describe.skipIf(!run)('Detección de rostros (face-api/WASM) integrada en el pipeline', async () => {
  const { createApp } = await import('../app.js');
  const { pool } = await import('../db/pool.js');
  const { getStorage } = await import('../storage/index.js');
  const { startWorker } = await import('../jobs/worker-core.js');
  const { allObjectKeys } = await import('../jobs/photo-keys.js');
  const app = createApp({ mailer: { send: async () => undefined } });
  const storage = getStorage();
  const astro = await fs.readFile(FIX);
  const tag = `${Date.now().toString(36)}f`;
  const pw = 'Clave-segura-123';
  const U = ['a', 'b'].map((k) => ({ k, username: `f${k}_${tag}`, email: `f${k}_${tag}@example.com`, cookie: [] as string[], id: '' }));
  const [A, B] = U as [(typeof U)[0], (typeof U)[0]];
  const as = (u: typeof A) => ({
    get: (url: string) => request(app).get(url).set('Cookie', u.cookie),
    post: (url: string) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', u.cookie),
  });
  const publish = (u: typeof A, img: Buffer, mime: string, fields: Record<string, string> = {}) => {
    let r = as(u).post('/api/posts').attach('photo', img, { filename: 'f.' + mime.split('/')[1], contentType: mime });
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r;
  };
  const poll = async (u: typeof A, id: string, until: (p: any) => boolean, ms = 90_000) => {
    const t0 = Date.now();
    for (;;) {
      const r = await as(u).get(`/api/posts/${id}`);
      if (r.body.post && until(r.body.post)) return r.body.post;
      if (Date.now() - t0 > ms) throw new Error(`Tiempo agotado: ${JSON.stringify(r.body.post?.faces)} ${JSON.stringify(r.body.post?.processing)}`);
      await new Promise((r2) => setTimeout(r2, 250));
    }
  };
  const done = (u: typeof A, id: string) => poll(u, id, (p) => p.processing.status === 'ready' && p.faces.status === 'done');
  const workers: { stop: (o?: { graceful?: boolean }) => Promise<void> }[] = [];
  const spawn = async (o: Parameters<typeof startWorker>[0] = {}) => { const w = await startWorker({ workerId: 'it-faces', ...o }); workers.push(w); return w; };
  const clearQueue = () => pool.query('DELETE FROM pgboss.job WHERE name = $1', [process.env.PHOTO_QUEUE]);
  afterEach(async () => {
    for (const w of workers.splice(0)) await w.stop({ graceful: false }).catch(() => undefined);
    await clearQueue();
  });
  beforeAll(async () => {
    await clearQueue();
    for (const u of U) {
      const r = await request(app).post('/api/auth/register').set('Origin', ORIGIN).send({ displayName: `Faces ${u.k}`, username: u.username, email: u.email, password: pw, confirmPassword: pw });
      u.cookie = r.headers['set-cookie'] as unknown as string[];
      u.id = r.body.user.id;
    }
  });
  afterAll(async () => {
    for (const u of U) {
      for (const r of (await pool.query('SELECT id FROM posts WHERE author_id = $1', [u.id])).rows) for (const k of allObjectKeys(u.id, r.id)) await storage.delete(k).catch(() => undefined);
    }
    await clearQueue();
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`f%_${tag}%`]);
    await pool.end();
  });

  it('detecta 1 rostro con recuadro preciso (IoU>0,5 contra anotación manual) y guarda SOLO recuadros normalizados', async () => {
    await spawn();
    const res = await publish(A, astro, 'image/png', { visibility: 'public' });
    expect(res.status).toBe(202);
    const post = await done(A, res.body.post.id);
    expect(post.faces.count).toBe(1);
    const f = post.faces.boxes[0];
    expect(f.score).toBeGreaterThan(0.9);
    for (const k of ['x', 'y', 'w', 'h']) { expect(f[k]).toBeGreaterThanOrEqual(0); expect(f[k]).toBeLessThanOrEqual(1); }
    expect(f.x + f.w).toBeLessThanOrEqual(1.0001);
    const px = { x: f.x * 512, y: f.y * 512, w: f.w * 512, h: f.h * 512 };
    expect(iou(px, FACE_512)).toBeGreaterThan(0.5);

    // Privacidad: únicamente {x,y,w,h,score}; sin landmarks, descriptores, recortes ni atributos
    const row = (await pool.query('SELECT faces, faces_status, faces_model FROM photos WHERE post_id = $1', [post.id])).rows[0];
    expect(row.faces_status).toBe('done');
    expect(row.faces_model).toMatch(/^ssd_mobilenetv1@/);
    expect(Object.keys(row.faces[0]).sort()).toEqual(['h', 'score', 'w', 'x', 'y']);
    expect(JSON.stringify(row.faces)).not.toMatch(/landmark|descriptor|embedding|age|gender|expression|name/i);
    // Sin objetos adicionales en el almacenamiento: original + 5 variantes, ningún recorte de rostro
    const present: string[] = [];
    for (const k of allObjectKeys(A.id, post.id)) if (await storage.exists(k)) present.push(k);
    expect(present).toHaveLength(6);
    // Sin tablas ni columnas biométricas
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND (column_name ~* '(^|_)(embedding|descriptor|biometric|template|landmarks?|age|gender|ethnicity)(_|$)' )")).rows;
    expect(cols).toEqual([]);
  });

  it('detecta 2 rostros en una composición y los localiza con precisión', async () => {
    await spawn();
    const W = 1400, H = 720;
    const a = await sharp(astro).resize(640).toBuffer();
    const b = await sharp(astro).resize(480).toBuffer();
    const img = await sharp({ create: { width: W, height: H, channels: 3, background: '#3a3350' } }).composite([{ input: a, left: 40, top: 40 }, { input: b, left: 780, top: 120 }]).jpeg({ quality: 92 }).toBuffer();
    const post = await done(A, (await publish(A, img, 'image/jpeg')).body.post.id);
    expect(post.faces.count).toBe(2);
    const exp = [place(640 / 512, 40, 40), place(480 / 512, 780, 120)]; // ya ordenados de izquierda a derecha
    post.faces.boxes.forEach((f: Box, i: number) => expect(iou({ x: f.x * W, y: f.y * H, w: f.w * W, h: f.h * H }, exp[i]!), `rostro ${i + 1}`).toBeGreaterThan(0.45));
  });

  it('una fotografía sin rostros termina «done» con 0 y sin recuadros', async () => {
    await spawn();
    const land = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2f6f8f' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><circle cx="800" cy="300" r="120" fill="#fff3c4"/><path d="M0 600 L300 300 L600 600Z" fill="#2b2144"/></svg>') }]).jpeg().toBuffer();
    const post = await done(A, (await publish(A, land, 'image/jpeg')).body.post.id);
    expect(post.faces).toEqual({ status: 'done', count: 0, boxes: [] });
  });

  it('respeta la orientación EXIF: los recuadros corresponden a la imagen orientada (como se ve)', async () => {
    await spawn();
    const upW = 800, upH = 500; // imagen tal como se ve
    const body = await sharp(astro).resize(500).toBuffer();
    const upright = await sharp({ create: { width: upW, height: upH, channels: 3, background: '#26324f' } }).composite([{ input: body, left: 150, top: 0 }]).png().toBuffer();
    const stored = await sharp(upright).rotate(270).png().toBuffer(); // píxeles girados 90° ↺ (500×800)…
    const tagged = await sharp(stored).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer(); // …y etiqueta EXIF 6 (↻ 90°) → se ve vertical-correcta
    const post = await done(A, (await publish(A, tagged, 'image/jpeg')).body.post.id);
    expect(post.photo).toMatchObject({ width: upW, height: upH });
    expect(post.faces.count).toBe(1);
    const f = post.faces.boxes[0];
    expect(iou({ x: f.x * upW, y: f.y * upH, w: f.w * upW, h: f.h * upH }, place(500 / 512, 150, 0))).toBeGreaterThan(0.45);
  });

  it('privacidad: los resultados siguen la visibilidad de la fotografía (privada → solo autor)', async () => {
    await spawn();
    const priv = await done(A, (await publish(A, astro, 'image/png', { visibility: 'private' })).body.post.id);
    const pub = await done(A, (await publish(A, astro, 'image/png', { visibility: 'public' })).body.post.id);
    expect(priv.faces.count).toBe(1);
    expect((await as(B).get(`/api/posts/${priv.id}`)).status).toBe(404); // ni la foto ni sus recuadros
    expect(JSON.stringify((await as(B).get('/api/explore')).body)).not.toContain(priv.id);
    expect((await as(B).get(`/api/posts/${pub.id}`)).body.post.faces.count).toBe(1);
    expect((await request(app).get(`/api/posts/${pub.id}`)).status).toBe(401);
  });

  it('si el detector falla la fotografía queda lista (faces «failed»); el autor puede reanalizar sin cambiar su estado visible', async () => {
    const failing = { model: 'falla-simulada', detect: async () => { throw new Error('WASM no disponible (simulado)'); } };
    await spawn({ detector: failing });
    const res = await publish(A, astro, 'image/png', { visibility: 'public' });
    const post = await poll(A, res.body.post.id, (p) => p.processing.status === 'ready' && p.faces.status === 'failed');
    expect(post.faces).toEqual({ status: 'failed', count: 0, boxes: [] });
    expect((await as(B).post(`/api/posts/${post.id}/faces/reanalyze`)).status).toBe(404); // solo el autor
    for (const w of workers.splice(0)) await w.stop({ graceful: false });
    await clearQueue();
    await spawn(); // detector real
    expect((await as(A).post(`/api/posts/${post.id}/faces/reanalyze`)).status).toBe(202);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) { // mientras se reanaliza, el estado visible NO cambia
      const p = (await as(A).get(`/api/posts/${post.id}`)).body.post;
      seen.add(p.processing.status);
      if (p.faces.status === 'done') { expect(p.faces.count).toBe(1); break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    expect([...seen]).toEqual(['ready']);
  });

  it('fotografías previas sin análisis (faces «pending», ya listas) se analizan en segundo plano sin pasar a «processing»', async () => {
    await spawn();
    const post = await done(A, (await publish(A, astro, 'image/png')).body.post.id);
    const before = (await pool.query('SELECT attempts, status FROM photos WHERE post_id = $1', [post.id])).rows[0];
    for (const w of workers.splice(0)) await w.stop({ graceful: false });
    await clearQueue();
    await pool.query("UPDATE photos SET faces_status = 'pending', faces = '[]', faces_model = NULL WHERE post_id = $1", [post.id]);
    await spawn(); // el barrido inicial del worker encola el análisis pendiente
    const after = await poll(A, post.id, (p) => p.faces.status === 'done');
    expect(after.faces.count).toBe(1);
    const row = (await pool.query('SELECT attempts, status FROM photos WHERE post_id = $1', [post.id])).rows[0];
    expect(row).toEqual(before); // mismos intentos y estado: no se reprocesaron las variantes
  });
});
