// Integración REAL: PostgreSQL + Mailpit (SMTP local). Ejecutar: npm run test:integration -w @lumenza/api
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { ORIGIN, deleteMailsTo, mailsTo, waitForToken } from '../../test/helpers.js';

const run = process.env.INTEGRATION === '1';

describe.skipIf(!run)('Verificación de correo y recuperación de contraseña', async () => {
  const { createApp } = await import('../../app.js');
  const { pool } = await import('../../db/pool.js');
  const app = createApp();
  const tag = `${Date.now().toString(36)}f`;
  const email = `f_${tag}@example.com`;
  const password = 'Clave-segura-123';
  const reg = { displayName: 'Flujo Uno', username: `f_${tag}`, email, password, confirmPassword: password };
  const post = (url: string, body?: object) => request(app).post(url).set('Origin', ORIGIN).send(body);
  let cookie: string[] = [];
  const dbUser = async () => (await pool.query('SELECT id, email_verified FROM users WHERE email = $1', [email])).rows[0];

  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE 'f\\_%' AND email LIKE $1", [`%${tag}%`]);
    await deleteMailsTo(email);
  });

  it('el registro envía un correo real de verificación y guarda solo el hash del token', async () => {
    const r = await post('/api/auth/register', reg);
    expect(r.status).toBe(201);
    expect(r.body.user.emailVerified).toBe(false);
    cookie = r.headers['set-cookie'] as unknown as string[];
    const token = await waitForToken(email, 'Confirma tu correo');
    const rows = (await pool.query('SELECT token_hash, expires_at, used_at FROM email_tokens WHERE user_id = $1 AND purpose = $2', [(await dbUser()).id, 'verify_email'])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(rows[0].used_at).toBeNull();
  });

  it('reenvío controlado: cooldown de 60 s y el token anterior queda invalidado', async () => {
    const early = await post('/api/auth/resend-verification').set('Cookie', cookie);
    expect(early.status).toBe(429);
    expect(early.body.error.code).toBe('resend_cooldown');
    await pool.query("UPDATE email_tokens SET created_at = now() - interval '2 minutes' WHERE user_id = $1", [(await dbUser()).id]);
    const first = await waitForToken(email, 'Confirma tu correo');
    const ok = await post('/api/auth/resend-verification').set('Cookie', cookie);
    expect(ok.status).toBe(202);
    await waitForToken(email, 'Confirma tu correo', 2);
    const old = await post('/api/auth/verify-email', { token: first });
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe('token_used'); // invalidado por el reenvío
  });

  it('token expirado → token_expired y el correo sigue sin verificar', async () => {
    const id = (await dbUser()).id;
    const { rows } = await pool.query("SELECT 1 FROM email_tokens WHERE user_id=$1 AND used_at IS NULL", [id]);
    expect(rows).toHaveLength(1);
    await pool.query("UPDATE email_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND used_at IS NULL", [id]);
    const mails = (await mailsTo(email)).filter((m) => m.subject.includes('Confirma tu correo'));
    const latest = mails[0]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
    const res = await post('/api/auth/verify-email', { token: latest });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('token_expired');
    expect((await dbUser()).email_verified).toBe(false);
  });

  it('token inválido → token_invalid', async () => {
    const res = await post('/api/auth/verify-email', { token: 'x'.repeat(43) });
    expect(res.body.error.code).toBe('token_invalid');
  });

  it('verificación válida persiste en PostgreSQL y el token es de un solo uso', async () => {
    await pool.query("UPDATE email_tokens SET expires_at = now() + interval '1 hour', created_at = now() - interval '5 minutes' WHERE user_id = $1 AND used_at IS NULL", [(await dbUser()).id]);
    const latest = (await mailsTo(email)).filter((m) => m.subject.includes('Confirma tu correo'))[0]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
    const ok = await post('/api/auth/verify-email', { token: latest });
    expect(ok.status).toBe(200);
    expect((await dbUser()).email_verified).toBe(true);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).body.user.emailVerified).toBe(true);
    const again = await post('/api/auth/verify-email', { token: latest });
    expect(again.body.error.code).toBe('token_used');
    expect((await post('/api/auth/resend-verification').set('Cookie', cookie)).status).toBe(409);
  });

  it('forgot-password: misma respuesta exista o no la cuenta; solo la existente recibe correo', async () => {
    const ghost = `nadie_${tag}@example.com`;
    const a = await post('/api/auth/forgot-password', { email });
    const b = await post('/api/auth/forgot-password', { email: ghost });
    expect(a.status).toBe(202);
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    await waitForToken(email, 'Restablece tu contraseña');
    expect(await mailsTo(ghost)).toHaveLength(0);
  });

  it('token de recuperación inválido es rechazado (validate y reset)', async () => {
    const bad = 'z'.repeat(43);
    expect((await post('/api/auth/reset-password/validate', { token: bad })).body.error.code).toBe('token_invalid');
    const r = await post('/api/auth/reset-password', { token: bad, password: 'NuevaClave-456', confirmPassword: 'NuevaClave-456' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('token_invalid');
  });

  it('restablecer: nueva contraseña Argon2id, token de un solo uso y TODAS las sesiones revocadas', async () => {
    const login = await post('/api/auth/login', { identifier: email, password });
    const oldCookie = login.headers['set-cookie'] as unknown as string[];
    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(200);

    const token = await waitForToken(email, 'Restablece tu contraseña');
    expect((await post('/api/auth/reset-password/validate', { token })).status).toBe(200);
    const nuevo = 'NuevaClave-456';
    expect((await post('/api/auth/reset-password', { token, password: nuevo, confirmPassword: 'otra-distinta-1' })).status).toBe(400); // no coincide
    const done = await post('/api/auth/reset-password', { token, password: nuevo, confirmPassword: nuevo });
    expect(done.status).toBe(200);

    const h = (await pool.query('SELECT password_hash FROM users WHERE email = $1', [email])).rows[0].password_hash as string;
    expect(h).toMatch(/^\$argon2id\$/);
    expect(h).not.toContain(nuevo);

    expect((await request(app).get('/api/auth/me').set('Cookie', oldCookie)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
    expect((await post('/api/auth/login', { identifier: email, password })).status).toBe(401);
    expect((await post('/api/auth/login', { identifier: email, password: nuevo })).status).toBe(200);

    const reuse = await post('/api/auth/reset-password', { token, password: 'Otra-Clave-789', confirmPassword: 'Otra-Clave-789' });
    expect(reuse.body.error.code).toBe('token_used');
    expect((await post('/api/auth/reset-password/validate', { token })).body.error.code).toBe('token_used');
  });

  it('enlace de recuperación vencido → token_expired', async () => {
    await pool.query("UPDATE email_tokens SET created_at = now() - interval '5 minutes' WHERE user_id = $1", [(await dbUser()).id]);
    await post('/api/auth/forgot-password', { email });
    await waitForToken(email, 'Restablece tu contraseña', 2);
    const mails = (await mailsTo(email)).filter((m) => m.subject.includes('Restablece'));
    const token = mails[0]!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
    await pool.query("UPDATE email_tokens SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND purpose = 'reset_password' AND used_at IS NULL", [(await dbUser()).id]);
    const res = await post('/api/auth/reset-password', { token, password: 'Clave-Nueva-111', confirmPassword: 'Clave-Nueva-111' });
    expect(res.body.error.code).toBe('token_expired');
  });

  it('eventos de seguridad quedan en audit_log sin tokens ni contraseñas', async () => {
    const { rows } = await pool.query('SELECT action, meta::text AS meta FROM audit_log WHERE user_id = $1', [(await dbUser()).id]);
    const actions = rows.map((r) => r.action);
    for (const a of ['auth.register', 'auth.email_verified', 'auth.password_reset_requested', 'auth.password_reset_done', 'auth.verification_resent']) expect(actions).toContain(a);
    expect(JSON.stringify(rows)).not.toMatch(/NuevaClave|Clave-segura|token=/);
  });

  it('acceso no autorizado y CSRF en endpoints nuevos', async () => {
    expect((await request(app).post('/api/auth/resend-verification').set('Origin', ORIGIN)).status).toBe(401);
    for (const url of ['/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email', '/api/auth/resend-verification']) {
      const r = await request(app).post(url).set('Origin', 'https://evil.example').send({ email });
      expect(r.status, url).toBe(403);
    }
  });
});

describe.skipIf(!run)('Rate limiting (límites reales de producción)', async () => {
  const { createApp } = await import('../../app.js');
  const strict = createApp({ strictLimits: true });
  const post = (url: string, body: object) => request(strict).post(url).set('Origin', ORIGIN).send(body);
  it('forgot-password: 5 por hora y luego 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post('/api/auth/forgot-password', { email: `rl_${i}@example.com` })).status);
    expect(codes.slice(0, 5).every((c) => c === 202)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it('login: 10 intentos y luego 429 con código rate_limited', async () => {
    let last = 0;
    let code = '';
    for (let i = 0; i < 12; i++) {
      const r = await post('/api/auth/login', { identifier: 'rl@example.com', password: 'mala-clave-1' });
      last = r.status;
      code = r.body.error?.code;
    }
    expect(last).toBe(429);
    expect(code).toBe('rate_limited');
  });
});

afterAll(async () => {
  if (run) await (await import('../../db/pool.js')).pool.end();
});
