import sharp, { type Sharp } from 'sharp';

/** Imagen RGB de 8 bits sin comprimir (una sola decodificación del original sirve para todas las variantes). */
export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

export type VariantKind = 'display' | 'thumbnail' | 'bw_editorial' | 'sepia_cinema' | 'lumen_tone';
export const TRANSFORM_KINDS = ['bw_editorial', 'sepia_cinema', 'lumen_tone'] as const;
export const ALL_KINDS: VariantKind[] = ['display', 'thumbnail', ...TRANSFORM_KINDS];

export interface VariantOutput {
  buffer: Buffer;
  width: number;
  height: number;
  params: Record<string, unknown>;
}

const MAX_TRANSFORM_SIDE = 1800;
const src = (r: RawImage) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } });

function fit(r: RawImage, side: number) {
  const s = Math.min(1, side / Math.max(r.width, r.height));
  return { width: Math.max(1, Math.round(r.width * s)), height: Math.max(1, Math.round(r.height * s)) };
}

const svg = (s: string) => Buffer.from(s);
const vignette = (w: number, h: number, strength: number) =>
  svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="78%"><stop offset="52%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${strength}"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`);
const violetGlow = (w: number, h: number) =>
  svg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd" stop-opacity="0.50"/><stop offset="0.55" stop-color="#9673f7" stop-opacity="0.10"/><stop offset="1" stop-color="#1d1d29" stop-opacity="0.60"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);

const webp = (p: Sharp, quality: number) => p.webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
const out = async (p: Sharp, quality: number, params: Record<string, unknown>): Promise<VariantOutput> => {
  const r = await webp(p, quality);
  return { buffer: r.data, width: r.info.width, height: r.info.height, params: { format: 'webp', quality, ...params } };
};

/** Versión de visualización (1440 px) para feed y detalle. */
export const makeDisplay = (r: RawImage) => out(src(r).resize({ ...fit(r, 1440) }), 82, { recipe: 'display@1', maxSide: 1440 });

/** Miniatura (640 px) para cuadrículas. */
export const makeThumbnail = (r: RawImage) => out(src(r).resize({ ...fit(r, 640) }), 78, { recipe: 'thumbnail@1', maxSide: 640 });

/**
 * Blanco y negro editorial: conversión por luminancia Rec.601, estiramiento de histograma (1–99 %), curva de contraste
 * moderada con gamma suave y nitidez ligera para conservar el detalle. Viñeta tenue para foco editorial.
 */
async function bwEditorial(r: RawImage) {
  const { width, height } = fit(r, MAX_TRANSFORM_SIDE);
  const lum: [number, number, number] = [0.299, 0.587, 0.114];
  const base = await src(r).resize({ width, height }).recomb([lum, lum, lum]).normalise({ lower: 1, upper: 99 }).linear(1.1, -11).gamma(1.06).sharpen({ sigma: 0.7, m1: 0.8, m2: 1.4 }).png({ compressionLevel: 1 }).toBuffer();
  return out(sharp(base).composite([{ input: vignette(width, height, 0.28) }]), 86, { recipe: 'bw-editorial@1', luminance: 'rec601', contrast: 1.1, gamma: 1.06, normalise: '1-99%', vignette: 0.28 });
}

/**
 * Sepia cinematográfico: desaturación casi total (conserva un 20 % de color), tinte cálido por luminancia (L*a*b*)
 * para no quemar luces, negros levantados, gamma cálida y viñeta de proyección.
 */
async function sepiaCinema(r: RawImage) {
  const { width, height } = fit(r, MAX_TRANSFORM_SIDE);
  const base = await src(r).resize({ width, height }).modulate({ saturation: 0.2 }).tint({ r: 196, g: 140, b: 92 }).linear(0.94, 12).gamma(1.08).png({ compressionLevel: 1 }).toBuffer();
  return out(sharp(base).composite([{ input: vignette(width, height, 0.42) }]), 86, { recipe: 'sepia-cinema@1', tint: '#c48c5c', saturation: 0.2, blacksLift: 12, highlightScale: 0.94, gamma: 1.08, vignette: 0.42 });
}

/**
 * Tono LUMENZA (identidad propia): sombras hacia violeta y altas luces lilas mediante balance por canal, saturación
 * contenida, resplandor degradado «soft-light» lila→violeta→grafito y nitidez ligera. Sin sobresaturar.
 */
async function lumenTone(r: RawImage) {
  const { width, height } = fit(r, MAX_TRANSFORM_SIDE);
  const base = await src(r).resize({ width, height }).modulate({ brightness: 1.02, saturation: 1.06 }).linear([1.03, 0.99, 1.08], [4, 0, 14]).png({ compressionLevel: 1 }).toBuffer();
  return out(sharp(base).composite([{ input: violetGlow(width, height), blend: 'soft-light' }]).sharpen({ sigma: 0.6, m1: 0.6, m2: 1.2 }), 86, {
    recipe: 'lumen-tone@1', channelGain: [1.03, 0.99, 1.08], channelOffset: [4, 0, 14], saturation: 1.06, glow: '#c4b5fd→#9673f7→#1d1d29 soft-light',
  });
}

export function makeVariant(kind: VariantKind, r: RawImage): Promise<VariantOutput> {
  switch (kind) {
    case 'display': return makeDisplay(r);
    case 'thumbnail': return makeThumbnail(r);
    case 'bw_editorial': return bwEditorial(r);
    case 'sepia_cinema': return sepiaCinema(r);
    case 'lumen_tone': return lumenTone(r);
  }
}

export const LIMITS = { maxInputPixels: 60_000_000, workingSide: 2400 };

/**
 * Decodifica UNA vez el original (límite de píxeles, auto-orientación EXIF, sRGB, sin alfa) a un tamaño de trabajo
 * acotado (2400 px) para limitar memoria; todas las variantes parten de este raster, nunca del archivo ya filtrado.
 */
export async function toRaw(original: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(original, { limitInputPixels: LIMITS.maxInputPixels })
    .rotate()
    .resize({ width: LIMITS.workingSide, height: LIMITS.workingSide, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
