// Herramienta de desarrollo: genera las variantes de una imagen y una hoja de contacto para revisarlas a ojo.
// Uso: npm run preview:transforms -w @lumenza/api -- [imagen] [carpetaSalida]
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ALL_KINDS, makeVariant, toRaw } from '../images/transforms.js';

const [input, outDir = path.resolve('preview-out')] = process.argv.slice(2);
await fs.mkdir(outDir, { recursive: true });

/** Escena sintética con cielo, sol, montañas, agua y una zona de piel/tonos cálidos para juzgar color y contraste. */
async function scene() {
  const w = 2000, h = 1300;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a6b"/><stop offset=".55" stop-color="#e0805a"/><stop offset="1" stop-color="#f6d28b"/></linearGradient>
  <radialGradient id="sun" cx=".7" cy=".52" r=".12"><stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#fff6c8" stop-opacity="0"/></radialGradient>
  <linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6f8f"/><stop offset="1" stop-color="#0d2b3d"/></linearGradient></defs>
  <rect width="100%" height="62%" fill="url(#sky)"/><rect width="100%" height="62%" fill="url(#sun)"/>
  <path d="M0 800 L260 520 L470 700 L760 430 L1100 760 L1380 560 L1700 740 L2000 600 L2000 820 L0 820Z" fill="#2b2144"/>
  <path d="M0 860 L300 700 L620 850 L980 690 L1400 860 L1750 730 L2000 840 L2000 860 L0 860Z" fill="#40305f"/>
  <rect y="806" width="100%" height="494" fill="url(#water)"/>
  <ellipse cx="1400" cy="900" rx="240" ry="26" fill="#ffd9a0" opacity=".55"/><ellipse cx="1400" cy="960" rx="130" ry="14" fill="#ffd9a0" opacity=".35"/>
  <circle cx="420" cy="1030" r="120" fill="#d99a73"/><circle cx="420" cy="1030" r="120" fill="none" stroke="#7a3d2b" stroke-width="10"/>
  <rect x="640" y="960" width="180" height="230" rx="18" fill="#b0323c"/><rect x="860" y="1010" width="160" height="180" rx="18" fill="#3a9d5d"/><rect x="1060" y="990" width="140" height="200" rx="18" fill="#e9c34a"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

const source = input ? await fs.readFile(input) : await scene();
const raw = await toRaw(source);
const tiles: { name: string; buf: Buffer }[] = [{ name: 'original', buf: await sharp(source).resize(600).jpeg({ quality: 85 }).toBuffer() }];
for (const kind of ALL_KINDS.filter((k) => k !== 'thumbnail')) {
  const t0 = Date.now();
  const v = await makeVariant(kind, raw);
  await fs.writeFile(path.join(outDir, `${kind}.webp`), v.buffer);
  tiles.push({ name: kind, buf: await sharp(v.buffer).resize(600).jpeg({ quality: 85 }).toBuffer() });
  console.log(`${kind}: ${v.width}x${v.height} ${(v.buffer.length / 1024).toFixed(0)} KB en ${Date.now() - t0} ms`);
}
const th = (await sharp(tiles[0]!.buf).metadata()).height!;
const sheet = await sharp({ create: { width: 600 * 3, height: th * 2, channels: 3, background: '#111' } })
  .composite(await Promise.all(tiles.map(async (t, i) => ({ input: await sharp(t.buf).resize(600, th, { fit: 'cover' }).toBuffer(), left: (i % 3) * 600, top: Math.floor(i / 3) * th }))))
  .jpeg({ quality: 88 }).toBuffer();
await fs.writeFile(path.join(outDir, 'contact-sheet.jpg'), sheet);
console.log(`Hoja de contacto: ${path.join(outDir, 'contact-sheet.jpg')}`);
