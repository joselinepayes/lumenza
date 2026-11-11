import { randomBytes } from 'node:crypto';
import { generateSync } from 'otplib';
import { describe, expect, it } from 'vitest';
import { totpAt } from '../../test/totp.js';
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecovery, normalizeRecovery } from './mfa.crypto.js';

// Secreto ASCII "12345678901234567890" en base32 y vectores de prueba de RFC 6238 (HMAC-SHA1, 6 dígitos = últimos 6 de los de 8)
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const VECTORS: [number, string][] = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];

describe('TOTP (RFC 6238)', () => {
  it('la implementación independiente de la prueba cumple los vectores oficiales', () => {
    for (const [t, code] of VECTORS) expect(totpAt(RFC_SECRET, t), `t=${t}`).toBe(code);
  });
  it('otplib (la librería del servidor) produce los mismos códigos que los vectores oficiales', () => {
    for (const [t, code] of VECTORS) expect(generateSync({ secret: RFC_SECRET, epoch: t }), `t=${t}`).toBe(code);
  });
});

describe('Cifrado de secretos (AES-256-GCM)', () => {
  const key = randomBytes(32);
  const user = '3f1c8e0a-0000-4000-8000-000000000001';

  it('cifra y descifra; el texto cifrado no contiene el secreto y cambia en cada cifrado (IV aleatorio)', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const a = encryptSecret(secret, user, key);
    const b = encryptSecret(secret, user, key);
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(a).not.toContain(secret);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, user, key)).toBe(secret);
  });
  it('rechaza clave distinta, usuario distinto (AAD) y manipulación', () => {
    const c = encryptSecret('SECRETO', user, key);
    expect(() => decryptSecret(c, user, randomBytes(32))).toThrow();
    expect(() => decryptSecret(c, '3f1c8e0a-0000-4000-8000-000000000002', key)).toThrow(); // copiado a otra fila
    const parts = c.split('.');
    parts[3] = Buffer.from(Buffer.from(parts[3]!, 'base64url').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64url');
    expect(() => decryptSecret(parts.join('.'), user, key)).toThrow();
    expect(() => decryptSecret('v2.a.b.c', user, key)).toThrow();
  });
});

describe('Códigos de recuperación', () => {
  it('10 códigos únicos XXXXX-XXXXX sin caracteres ambiguos', () => {
    const codes = generateRecoveryCodes(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });
  it('normaliza minúsculas/espacios/guiones y rechaza formatos inválidos', () => {
    expect(normalizeRecovery('abcde fghjk')).toBe('ABCDE-FGHJK');
    expect(normalizeRecovery('abcde-fghjk')).toBe('ABCDE-FGHJK');
    expect(normalizeRecovery('ABCDE-FGHJ')).toBeNull();
    expect(normalizeRecovery('OOOOO-11111')).toBeNull(); // 0/O/1/I no están en el alfabeto
  });
  it('el hash es determinista, depende de la clave y no revela el código', () => {
    const k1 = randomBytes(32);
    const k2 = randomBytes(32);
    expect(hashRecovery('ABCDE-FGHJK', k1)).toBe(hashRecovery('ABCDE-FGHJK', k1));
    expect(hashRecovery('ABCDE-FGHJK', k1)).not.toBe(hashRecovery('ABCDE-FGHJK', k2));
    expect(hashRecovery('ABCDE-FGHJK', k1)).toMatch(/^[0-9a-f]{64}$/);
  });
});
