import request from 'supertest';
import { describe, expect, it } from 'vitest';

process.env.DATABASE_URL ??= 'postgres://x:x@127.0.0.1:1/x';
const { createApp } = await import('./app.js');

describe('API base', () => {
  const app = createApp();
  it('GET /api/health responde ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
  it('ruta inexistente devuelve 404 JSON', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
  it('envía cabeceras de seguridad', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
