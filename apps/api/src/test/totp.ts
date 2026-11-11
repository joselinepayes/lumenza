import { createHmac } from 'node:crypto';

/** Implementación INDEPENDIENTE de RFC 6238 (HMAC-SHA1, 6 dígitos, 30 s) para verificar el servidor sin usar su librería. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secretBase32: string, epochSeconds: number, digits = 6): string {
  const counter = Math.floor(epochSeconds / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Código del paso actual (+offset pasos de 30 s). */
export const totpNow = (secret: string, stepOffset = 0) => totpAt(secret, Date.now() / 1000 + stepOffset * 30);
