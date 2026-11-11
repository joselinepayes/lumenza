import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto';
import { env } from '../../config/env.js';

/** ¿Hay clave de cifrado configurada? Sin ella el MFA se deshabilita (nunca se usa una clave por defecto ni derivada de SESSION_SECRET). */
export const mfaAvailable = () => Boolean(env.MFA_ENCRYPTION_KEY);

const masterKey = (): Buffer => {
  if (!env.MFA_ENCRYPTION_KEY) throw new Error('MFA_ENCRYPTION_KEY no configurada');
  return Buffer.from(env.MFA_ENCRYPTION_KEY, 'base64');
};
const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/**
 * Cifra el secreto TOTP con AES-256-GCM. El `userId` se autentica como AAD: un secreto copiado a otra fila no descifra.
 * Formato: v1.<iv>.<tag>.<ciphertext> (base64url). El prefijo de versión permite rotar la clave en el futuro.
 */
export function encryptSecret(plain: string, userId: string, key: Buffer = masterKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(ct)}`;
}

export function decryptSecret(blob: string, userId: string, key: Buffer = masterKey()): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Formato de secreto no válido');
  const d = createDecipheriv('aes-256-gcm', key, unb64(iv));
  d.setAAD(Buffer.from(userId));
  d.setAuthTag(unb64(tag));
  return Buffer.concat([d.update(unb64(ct)), d.final()]).toString('utf8');
}

// ---- Códigos de recuperación: 10 códigos XXXXX-XXXXX de 50 bits; en BD solo HMAC con clave derivada (HKDF) ----
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
const recoveryKey = (key: Buffer = masterKey()) => Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'lumenza-mfa-recovery-v1', 32));

export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

/** Acepta minúsculas, espacios y guiones opcionales. Devuelve null si el formato no es válido. */
export function normalizeRecovery(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{10}$/.test(s)) return null;
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export const hashRecovery = (code: string, key?: Buffer) => createHmac('sha256', recoveryKey(key)).update(code).digest('hex');
