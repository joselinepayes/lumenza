import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://x:x@127.0.0.1:1/x';

// Límite global de /api (app.ts). Cada prueba hace UNA sola petición a /api/health (no usa BD ni servicios) y lee la cabecera
// estándar `RateLimit-Limit`; así no se satura nada ni se crean datos.
const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  vi.resetModules();
});

async function globalLimit(nodeEnv: 'test' | 'production', strictLimits?: boolean) {
  process.env.NODE_ENV = nodeEnv;
  vi.resetModules(); // env.ts se evalúa al importar: se reimporta con el NODE_ENV deseado
  const { createApp } = await import('./app.js');
  const res = await request(createApp({ strictLimits })).get('/api/health');
  expect(res.status).toBe(200);
  return { limit: Number(res.headers['ratelimit-limit']), policy: String(res.headers['ratelimit-policy']) };
}

describe('límite global de /api', () => {
  it('NODE_ENV=test sin strictLimits: 10 000 por minuto (entorno de pruebas automatizadas)', async () => {
    const r = await globalLimit('test', false);
    expect(r.limit).toBe(10_000);
    expect(r.policy).toBe('10000;w=60');
  });

  it('NODE_ENV=test con strictLimits=true: se mantiene el límite real de 300 por minuto', async () => {
    const r = await globalLimit('test', true);
    expect(r.limit).toBe(300);
    expect(r.policy).toBe('300;w=60');
  });

  it('NODE_ENV=production: 300 por minuto (strictLimits no influye)', async () => {
    for (const strict of [undefined, false, true]) {
      const r = await globalLimit('production', strict);
      expect(r.limit, `strictLimits=${strict}`).toBe(300);
      expect(r.policy).toBe('300;w=60');
    }
  });
});
