// La respuesta de Google (siteverify) está SIMULADA con fetch; se prueba nuestra lógica y mensajes, no el servicio real.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { createApp } from '../../app.js';
import { ORIGIN } from '../../test/helpers.js';
import { verifyRecaptcha } from './recaptcha.js';

describe('reCAPTCHA (backend)', () => {
  beforeEach(() => {
    env.RECAPTCHA_SITE_KEY = 'site-test';
    env.RECAPTCHA_SECRET_KEY = 'secret-test';
  });
  afterEach(() => {
    env.RECAPTCHA_SITE_KEY = undefined;
    env.RECAPTCHA_SECRET_KEY = undefined;
    vi.unstubAllGlobals();
  });

  it('sin token → 400 captcha_required', async () => {
    await expect(verifyRecaptcha(undefined)).rejects.toMatchObject({ status: 400, code: 'captcha_required' });
  });
  it('Google responde success:false → 400 captcha_failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    await expect(verifyRecaptcha('tok')).rejects.toMatchObject({ status: 400, code: 'captcha_failed' });
  });
  it('Google responde success:true → pasa y envía secret/response al endpoint oficial', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal('fetch', f);
    await expect(verifyRecaptcha('tok', '1.2.3.4')).resolves.toBeUndefined();
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: URLSearchParams }];
    expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(init.body.get('secret')).toBe('secret-test');
    expect(init.body.get('response')).toBe('tok');
  });
  it('Google inaccesible → 503 captcha_unavailable (no se omite la verificación)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('red caída'); }));
    await expect(verifyRecaptcha('tok')).rejects.toMatchObject({ status: 503, code: 'captcha_unavailable' });
  });
  it('registro, login y forgot-password exigen captcha cuando está configurado', async () => {
    const app = createApp();
    const body = { displayName: 'A', username: 'abc_def', email: 'a@example.com', password: 'Clave-segura-123', confirmPassword: 'Clave-segura-123' };
    for (const [url, b] of [['/api/auth/register', body], ['/api/auth/login', { identifier: 'a@example.com', password: 'x' }], ['/api/auth/forgot-password', { email: 'a@example.com' }]] as const) {
      const r = await request(app).post(url).set('Origin', ORIGIN).send(b);
      expect(r.status, url).toBe(400);
      expect(r.body.error.code).toBe('captcha_required');
    }
    expect((await request(app).get('/api/auth/config')).body.recaptcha).toEqual({ siteKey: 'site-test' });
  });
});
