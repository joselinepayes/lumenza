import sharp from 'sharp';
import { HttpError } from '../middleware/errors.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_PIXELS = 60_000_000;
const ALLOWED = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
type Format = keyof typeof ALLOWED;

export interface UploadInfo {
  format: Format;
  mime: string;
  ext: string;
  /** Dimensiones ya orientadas (EXIF aplicado). */
  width: number;
  height: number;
}

/**
 * Validación RÁPIDA en la petición HTTP (solo cabecera, sin decodificar píxeles): formato real por contenido (no por
 * extensión ni Content-Type), límite de píxeles y tamaño mínimo. La decodificación completa, el saneado de metadatos
 * y todas las variantes ocurren después en el worker, fuera de la petición.
 */
export async function validateUpload(input: Buffer): Promise<UploadInfo> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch (e) {
    if (/pixel limit|exceeds/i.test((e as Error).message)) throw new HttpError(400, 'La imagen supera el límite de resolución (60 megapíxeles)', 'image_too_large');
    throw new HttpError(400, 'El archivo no es una imagen válida', 'invalid_image');
  }
  const format = meta.format as Format | undefined;
  if (!format || !(format in ALLOWED)) throw new HttpError(400, 'Formato no admitido. Usa JPEG, PNG o WebP', 'unsupported_format');
  if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new HttpError(400, 'La imagen no es válida', 'invalid_image');
  if (meta.width * meta.height > MAX_PIXELS) throw new HttpError(400, 'La imagen supera el límite de resolución (60 megapíxeles)', 'image_too_large');
  if (meta.width < 200 || meta.height < 200) throw new HttpError(400, 'La imagen es demasiado pequeña (mínimo 200 px)', 'image_too_small');
  const swap = (meta.orientation ?? 1) >= 5;
  return { format, mime: ALLOWED[format], ext: format === 'jpeg' ? 'jpg' : format, width: swap ? meta.height : meta.width, height: swap ? meta.width : meta.height };
}

export async function processAvatar(input: Buffer): Promise<Buffer> {
  try {
    return await sharp(input, { limitInputPixels: MAX_PIXELS }).rotate().resize(320, 320, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
  } catch {
    throw new HttpError(400, 'El archivo no es una imagen válida', 'invalid_image');
  }
}
