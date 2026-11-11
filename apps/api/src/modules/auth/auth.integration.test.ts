// Integración REAL contra PostgreSQL. Ejecutar: npm run test:integration -w @lumenza/api
import dotenv from 'dotenv';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
dotenv.config({ path: '../../.env', quiet: true });

const run = process.env.INTEGRATION === '1';
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

describe.skipIf(!run)('Auth (PostgreSQL real)', async () => {
  const { createApp } = await import('../../app.js');
  const { pool } = await import('../../db/pool.js');
  const app = createApp();
  const tag = Date.now().toString(36);
  const user = { displayName: 'Prueba Uno', username: `t_${tag}`, email: `t_${tag}@example.com`, password: 'Clave-segura-123', confirmPassword: 'Clave-segura-123' };
  const post = (url: string, body?: object) => request(app).post(url).set('Origin', ORIGIN).send(body);
  let cookie: string[] = [];

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`t_${tag}%`]);
    await pool.query("DELETE FROM audit_log WHERE user_id IS NULL AND action = 'auth.login_failed' AND created_at > now() - interval '5 minutes'");
    await pool.end();
  });

  it('registra, guarda hash Argon2id con sal y abre sesión HttpOnly', async () => {
    const res = await post('/api/auth/register', user);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: user.username, email: user.email });
    expect(res.body.user.password_hash).toBeUndefined();
    cookie = res.headers['set-cookie'] as unknown as string[];
    expect(cookie.join(';')).toMatch(/lz_session=.+HttpOnly.+SameSite=Lax/i);
    const row = await pool.query('SELECT password_hash FROM users WHERE username = $1', [user.username]);
    expect(row.rows[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row.rows[0].password_hash).not.toContain(user.password);
  });

  it('dos usuarios con la misma contraseña obtienen hashes distintos (sal individual)', async () => {
    const other = { ...user, username: `t_${tag}b`, email: `t_${tag}b@example.com` };
    expect((await post('/api/auth/register', other)).status).toBe(201);
    const r = await pool.query('SELECT password_hash FROM users WHERE username IN ($1,$2)', [user.username, other.username]);
    expect(r.rows[0].password_hash).not.toBe(r.rows[1].password_hash);
  });

  it('rechaza email y username duplicados con 409', async () => {
    const a = await post('/api/auth/register', { ...user, username: `t_${tag}c` });
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe('email_taken');
    const b = await post('/api/auth/register', { ...user, email: `t_${tag}c@example.com` });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('username_taken');
  });

  it('valida datos (contraseña débil, no coincide, username inválido)', async () => {
    for (const bad of [{ password: 'corta1', confirmPassword: 'corta1' }, { confirmPassword: 'otra-cosa-123' }, { username: 'a b' }]) {
      const res = await post('/api/auth/register', { ...user, username: `t_${tag}z`, email: `t_${tag}z@example.com`, ...bad });
      expect(res.status).toBe(400);
    }
  });

  it('/me con cookie devuelve el usuario; sin cookie 401', async () => {
    const ok = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe(user.username);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });

  it('login por email y por username; credenciales erróneas dan 401 genérico', async () => {
    expect((await post('/api/auth/login', { identifier: user.email, password: user.password })).status).toBe(200);
    expect((await post('/api/auth/login', { identifier: user.username.toUpperCase(), password: user.password })).status).toBe(200);
    const bad = await post('/api/auth/login', { identifier: user.email, password: 'incorrecta-999' });
    const unknown = await post('/api/auth/login', { identifier: 'nadie@example.com', password: 'incorrecta-999' });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error.message).toBe(unknown.body.error.message);
  });

  it('bloquea peticiones POST con Origin ajeno (CSRF)', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ identifier: user.email, password: user.password });
    expect(res.status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({})).status).toBe(403);
  });

  it('username-available refleja la realidad', async () => {
    expect((await request(app).get(`/api/auth/username-available?u=${user.username}`)).body.available).toBe(false);
    expect((await request(app).get(`/api/auth/username-available?u=libre_${tag}`)).body.available).toBe(true);
  });

  it('logout revoca la sesión en servidor', async () => {
    expect((await post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('config informa honestamente que reCAPTCHA/Google no están configurados', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.body).toEqual({ recaptcha: null, google: false, mfa: true });
    const g = await request(app).get('/api/auth/google');
    expect(g.status).toBe(302);
    expect(g.headers.location).toContain('/login?error=google_not_configured');
  });
});
