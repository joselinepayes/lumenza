// Prueba de integración REAL contra RustFS/S3. Se ejecuta con: INTEGRATION=1 npm run test:integration
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
dotenv.config({ path: '../../.env', quiet: true });
import { S3Storage, StorageError } from './storage.service.js';

const run = process.env.INTEGRATION === '1';

describe.skipIf(!run)('StorageService contra S3 compatible (RustFS)', () => {
  const bucket = `lumenza-test-${Date.now()}`;
  const mk = (over: Partial<ConstructorParameters<typeof S3Storage>[0]> = {}) =>
    new S3Storage({
      bucket,
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: true,
      ...over,
    });
  const s = mk();
  const key = `tests/${Date.now()}.bin`;
  const data = randomBytes(64 * 1024);

  it('crea bucket y responde ping', async () => {
    await s.ensureBucket();
    expect(await s.ping()).toBe(true);
  });
  it('sube y descarga el mismo contenido', async () => {
    await s.put(key, data, 'application/octet-stream');
    expect(await s.exists(key)).toBe(true);
    const got = await s.get(key);
    expect(got.body.equals(data)).toBe(true);
  });
  it('URL firmada de lectura funciona; bucket privado rechaza acceso anónimo', async () => {
    const url = await s.signedGetUrl(key, 60);
    const ok = await fetch(url);
    expect(ok.status).toBe(200);
    expect(Buffer.from(await ok.arrayBuffer()).equals(data)).toBe(true);
    const anon = await fetch(url.split('?')[0]!);
    expect([401, 403]).toContain(anon.status);
  });
  it('elimina el objeto', async () => {
    await s.delete(key);
    expect(await s.exists(key)).toBe(false);
  });
  it('error controlado: objeto inexistente', async () => {
    await expect(s.get('no/existe')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('error controlado: credenciales inválidas', async () => {
    const bad = mk({ accessKeyId: 'x'.repeat(10), secretAccessKey: 'y'.repeat(20) });
    await expect(bad.put('a', Buffer.from('a'), 'text/plain')).rejects.toBeInstanceOf(StorageError);
  });
  it('error controlado: servicio caído', async () => {
    const down = mk({ endpoint: 'http://127.0.0.1:1' });
    await expect(down.get('a')).rejects.toMatchObject({ code: 'unavailable' });
    expect(await down.ping()).toBe(false);
  });
});
