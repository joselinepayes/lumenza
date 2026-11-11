// Datos de DEMOSTRACIÓN opt-in para desarrollo local: npm run seed:demo -w @lumenza/api  |  seed:demo -- clean
// Usa la API real (registro, subida, likes, comentarios). Las imágenes son composiciones generadas, no fotografías de personas.
// Todas las cuentas se llaman demo_* y los textos lo indican. Contraseña aleatoria impresa al final (no se guarda en el repo).
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';

const API = `http://localhost:${env.API_PORT}/api`;
const ORIGIN = env.WEB_ORIGIN;

if (process.argv[2] === 'clean') {
  const { getStorage } = await import('../storage/index.js');
  const keys = (await pool.query(`SELECT ph.storage_key AS k FROM photos ph JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id WHERE u.username::text LIKE 'demo\\_%' UNION ALL SELECT v.storage_key FROM photo_variants v JOIN photos ph ON ph.id = v.photo_id JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id WHERE u.username::text LIKE 'demo\\_%' UNION ALL SELECT pr.avatar_key FROM profiles pr JOIN users u ON u.id = pr.user_id WHERE u.username::text LIKE 'demo\\_%' AND pr.avatar_key IS NOT NULL`)).rows;
  for (const r of keys) await getStorage().delete(r.k).catch(() => undefined);
  const del = await pool.query("DELETE FROM users WHERE username::text LIKE 'demo\\_%'");
  console.log(`Eliminadas ${del.rowCount} cuentas demo y ${keys.length} objetos.`);
  await pool.end();
  process.exit(0);
}

const password = `Demo-${randomBytes(6).toString('hex')}-Ax1`;
const people = [
  { username: 'demo_lucia', name: 'Lucía Demo', bio: 'Cuenta de demostración · luz natural y paisajes.' },
  { username: 'demo_marco', name: 'Marco Demo', bio: 'Cuenta de demostración · arquitectura y ciudad.' },
  { username: 'demo_nora', name: 'Nora Demo', bio: 'Cuenta de demostración · retratos y arte.' },
];

// Composiciones generadas con la paleta de marca (SVG → PNG con sharp)
function art(w: number, h: number, seed: number, hue: number) {
  const r = (n: number) => ((Math.sin(seed * 97.13 + n * 12.9898) * 43758.5453) % 1 + 1) % 1;
  const blobs = Array.from({ length: 5 }, (_, i) => `<circle cx="${r(i) * w}" cy="${r(i + 9) * h}" r="${(0.18 + r(i + 3) * 0.35) * Math.min(w, h)}" fill="hsl(${hue + i * 18} ${55 + r(i) * 30}% ${35 + r(i + 5) * 35}%)" opacity="${0.35 + r(i + 7) * 0.4}"/>`).join('');
  const lines = Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${(h / 7) * i + r(i) * 40}" x2="${w}" y2="${(h / 7) * i + r(i + 2) * 120}" stroke="white" stroke-opacity="0.07" stroke-width="2"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 18%)"/><stop offset="1" stop-color="hsl(${hue + 50} 70% 48%)"/></linearGradient><filter id="b"><feGaussianBlur stdDeviation="${Math.min(w, h) / 14}"/></filter></defs><rect width="100%" height="100%" fill="url(#g)"/><g filter="url(#b)">${blobs}</g>${lines}</svg>`);
}

async function call(path: string, o: { method?: string; cookie?: string; json?: object; form?: FormData } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: o.method ?? 'GET',
    headers: { Origin: ORIGIN, ...(o.cookie ? { Cookie: o.cookie } : {}), ...(o.json ? { 'Content-Type': 'application/json' } : {}) },
    body: o.json ? JSON.stringify(o.json) : o.form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return { data: text ? JSON.parse(text) : {}, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

const sessions: { cookie: string; username: string }[] = [];
for (const p of people) {
  const exists = (await pool.query('SELECT 1 FROM users WHERE username = $1', [p.username])).rowCount;
  if (exists) { console.log(`${p.username} ya existe (usa "clean" primero)`); process.exit(1); }
  const r = await call('/auth/register', { method: 'POST', json: { displayName: p.name, username: p.username, email: `${p.username}@example.com`, password, confirmPassword: password } });
  await pool.query('UPDATE users SET email_verified = true WHERE username = $1', [p.username]);
  await call('/me/profile', { method: 'PATCH', cookie: r.cookie, json: { displayName: p.name, bio: p.bio } });
  sessions.push({ cookie: r.cookie, username: p.username });
}

const plan: [number, string, string, string, number, number, number][] = [
  // [autor, categoría, descripción, etiquetas, ancho, alto, tono]
  [0, 'naturaleza', 'Bruma en el valle (imagen de demostración generada)', 'luz niebla valle', 1600, 1100, 260],
  [0, 'viajes', 'Camino sin nombre (demostración)', 'ruta horizonte', 1200, 1600, 285],
  [0, 'naturaleza', 'Atardecer violeta (demostración)', 'atardecer luz', 1600, 1000, 300],
  [1, 'arquitectura', 'Geometría de vidrio (demostración)', 'arquitectura lineas', 1200, 1500, 230],
  [1, 'urbana', 'Noche en la avenida (demostración)', 'ciudad noche', 1600, 1067, 250],
  [1, 'arquitectura', 'Escalera infinita (demostración)', 'arquitectura minimal', 1100, 1500, 275],
  [2, 'retratos', 'Composición de color (demostración, sin personas reales)', 'color estudio', 1200, 1500, 320],
  [2, 'arte', 'Estudio de luz y sombra (demostración)', 'arte abstracto', 1500, 1500, 270],
  [2, 'gastronomia', 'Paleta de mercado (demostración)', 'color mesa', 1600, 1000, 20],
  [1, 'viajes', 'Puente al amanecer (demostración)', 'amanecer puente', 1600, 900, 210],
];
const posts: { id: string; author: number }[] = [];
for (const [i, [a, cat, caption, tags, w, h, hue]] of plan.entries()) {
  const png = await sharp(art(w, h, i + 1, hue)).png().toBuffer();
  const form = new FormData();
  form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), `demo-${i}.png`);
  form.append('caption', caption);
  form.append('tags', tags);
  form.append('category', cat);
  form.append('visibility', 'public');
  const r = await call('/posts', { method: 'POST', cookie: sessions[a]!.cookie, form });
  posts.push({ id: r.data.post.id, author: a });
}

// Relaciones e interacciones reales a través de la API
const follow = [[0, 1], [0, 2], [1, 0], [2, 0], [2, 1]] as const;
for (const [f, t] of follow) await call(`/users/${people[t]!.username}/follow`, { method: 'POST', cookie: sessions[f]!.cookie });
for (const [i, p] of posts.entries()) {
  for (const u of [0, 1, 2]) if (u !== p.author && (i + u) % 2 === 0) await call(`/posts/${p.id}/like`, { method: 'POST', cookie: sessions[u]!.cookie });
  if (i % 3 === 0) await call(`/posts/${p.id}/comments`, { method: 'POST', cookie: sessions[(p.author + 1) % 3]!.cookie, json: { body: 'Comentario de demostración: ¡qué buena composición!' } });
}
await call(`/posts/${posts[3]!.id}/save`, { method: 'POST', cookie: sessions[0]!.cookie });

console.log('\nDatos de DEMOSTRACIÓN creados (3 cuentas, 10 publicaciones).');
console.log(`Usuarios: ${people.map((p) => p.username).join(', ')}  ·  Contraseña (solo local): ${password}`);
console.log('Para eliminarlos: npm run seed:demo -w @lumenza/api -- clean');
await pool.end();
