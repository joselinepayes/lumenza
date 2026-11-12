import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({ path: '../../.env', quiet: true });

const MAILPIT = 'http://localhost:8025/api/v1';
export const ORIGIN = 'http://localhost:5174';

export const uniqueUser = (prefix: string) => {
  const t = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return { name: 'Persona E2E', username: t, email: `${t}@example.com`, password: 'Clave-E2E-segura-1' };
};

/** Token del último correo real recibido en Mailpit con ese asunto (espera hasta 8 s). */
export async function tokenFromMail(address: string, subjectPart: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as { messages: { ID: string; Subject: string }[] };
    const hit = list.messages.find((m) => m.Subject.includes(subjectPart));
    if (hit) {
      const d = (await (await fetch(`${MAILPIT}/message/${hit.ID}`)).json()) as { Text: string };
      const t = d.Text.match(/token=([A-Za-z0-9_-]+)/);
      if (t) return t[1]!;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No llegó el correo "${subjectPart}" a ${address}`);
}

/** Elimina el usuario de prueba, sus objetos de almacenamiento (la BD solo guarda claves) y sus correos. */
export async function cleanup(email: string) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const keys = (
    await c.query(
      `SELECT ph.storage_key AS k FROM photos ph JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id WHERE u.email = $1
       UNION SELECT v.storage_key FROM photo_variants v JOIN photos ph ON ph.id = v.photo_id JOIN posts p ON p.id = ph.post_id JOIN users u ON u.id = p.author_id WHERE u.email = $1
       UNION SELECT pr.avatar_key FROM profiles pr JOIN users u ON u.id = pr.user_id WHERE u.email = $1 AND pr.avatar_key IS NOT NULL`,
      [email],
    )
  ).rows;
  if (keys.length) {
    const s3 = new S3Client({ region: process.env.S3_REGION ?? 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
    for (const r of keys) await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'lumenza-media', Key: r.k })).catch(() => undefined);
  }
  await c.query('DELETE FROM users WHERE email = $1', [email]);
  await c.end();
  const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${email}`)}`)).json()) as { messages: { ID: string }[] };
  if (list.messages.length) await fetch(`${MAILPIT}/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: list.messages.map((m) => m.ID) }) });
}

export async function jpegBuffer(w = 1200, h = 800, color = '#9673f7') {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
}

// ---- MFA ----
import { createHmac } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
/** TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s) del paso ABSOLUTO indicado (contador = floor(epoch / 30)). No depende del reloj. */
export function totpAtStep(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}
/** Código del paso actual (+ `step` ventanas de 30 s) según el reloj de este momento. Para pruebas sensibles al reloj usa `totpAtStep`. */
export const totpNow = (secret: string, step = 0): string => totpAtStep(secret, Math.floor(Date.now() / 1000 / 30) + step);

export async function sql(query: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { return (await c.query(query, params)).rows; } finally { await c.end(); }
}
/** Simula el paso de los 30 s: libera el último paso TOTP usado (para poder reutilizar el reloj real en la prueba). */
export const freeMfaStep = (email: string) => sql('UPDATE user_mfa SET last_used_step = NULL WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);
/** Paso TOTP que el BACKEND registró como último usado (null si ninguno): es el código realmente gastado, sin suponer el reloj. */
export const lastUsedMfaStep = async (email: string): Promise<number | null> => {
  const rows = await sql('SELECT last_used_step FROM user_mfa WHERE user_id = (SELECT id FROM users WHERE email = $1)', [email]);
  const v = rows[0]?.last_used_step as string | number | null | undefined;
  return v === null || v === undefined ? null : Number(v);
};
/** Motivos de los fallos de MFA registrados en la auditoría, en orden (bad_totp = inválido/caducado; totp_replay = reutilizado). */
export const mfaFailureReasons = async (email: string): Promise<string[]> =>
  (await sql("SELECT meta->>'reason' AS reason FROM audit_log WHERE action = 'auth.mfa_failed' AND user_id = (SELECT id FROM users WHERE email = $1) ORDER BY id", [email])).map((r) => r.reason as string);
export const makeAdmin =(email: string) => sql("UPDATE users SET role = 'admin' WHERE email = $1", [email]);
