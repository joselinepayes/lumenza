// Prueba la LÓGICA de nuestro flujo OAuth (state, cookie firmada, vinculación segura) contra PostgreSQL real.
// El proveedor de Google está SIMULADO: esto NO prueba la comunicación con Google (requiere credenciales reales).
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers.js';
import type { GoogleClaims, GoogleProvider } from './google.js';

const run = process.env.INTEGRATION === '1';

describe.skipIf(!run)('Google OAuth: lógica de callback (proveedor simulado)', async () => {
  const { createApp } = await import('../../app.js');
  const { pool } = await import('../../db/pool.js');
  const tag = `${Date.now().toString(36)}g`;
  let next: GoogleClaims | Error = { sub: 'x', email: 'x@example.com', emailVerified: true };
  const fake: GoogleProvider = {
    enabled: true,
    start: () => ({ url: 'https://accounts.google.example/auth?x=1', state: 'state-123', verifier: 'ver-456', nonce: 'nonce-789' }),
    exchange: async (code, verifier, nonce) => {
      if (code !== 'good-code' || verifier !== 'ver-456' || nonce !== 'nonce-789') throw new Error('PKCE/nonce inválidos');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  const app = createApp({ google: fake });
  const sess = (res: request.Response) => ((res.headers['set-cookie'] as unknown as string[]) ?? []).some((c) => c.startsWith('lz_session='));

  /** Inicia el flujo y devuelve la cookie firmada del estado, como haría el navegador. */
  async function begin() {
    const r = await request(app).get('/api/auth/google');
    expect(r.status).toBe(302);
    expect(r.headers.location).toContain('accounts.google.example');
    return (r.headers['set-cookie'] as unknown as string[]).filter((c) => c.startsWith('lz_oauth='));
  }
  const callback = (cookie: string[], q: string) => request(app).get(`/api/auth/google/callback?${q}`).set('Cookie', cookie);

  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`g_${tag}%`]);
    await pool.end();
  });

  it('inicio del flujo: cookie firmada HttpOnly de 10 min limitada a la ruta de Google', async () => {
    const c = (await begin())[0]!;
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Lax/i);
    expect(c).toMatch(/Path=\/api\/auth\/google/);
    expect(decodeURIComponent(c)).toMatch(/^lz_oauth=s:/); // firmada (HMAC)
  });

  it('rechaza state incorrecto, ausente o cookie ausente (CSRF) y no abre sesión', async () => {
    const cookie = await begin();
    const wrong = await callback(cookie, 'code=good-code&state=otro');
    expect(wrong.headers.location).toContain('error=google_state');
    expect(sess(wrong)).toBe(false);
    expect((await callback(cookie, 'code=good-code')).headers.location).toContain('error=google_state');
    expect((await callback([], 'code=good-code&state=state-123')).headers.location).toContain('error=google_state');
  });

  it('cookie manipulada es rechazada', async () => {
    const forged = ['lz_oauth=' + encodeURIComponent('s:' + JSON.stringify({ state: 'state-123' }) + '.firmafalsa') + '; Path=/api/auth/google'];
    expect((await callback(forged, 'code=good-code&state=state-123')).headers.location).toContain('error=google_state');
  });

  it('cancelación del usuario → google_cancelled', async () => {
    const r = await callback(await begin(), 'error=access_denied&state=state-123');
    expect(r.headers.location).toContain('error=google_cancelled');
    expect(sess(r)).toBe(false);
  });

  it('fallo del intercambio (código/PKCE inválido) → google_failed sin sesión', async () => {
    const r = await callback(await begin(), 'code=mal-code&state=state-123');
    expect(r.headers.location).toContain('error=google_failed');
    expect(sess(r)).toBe(false);
  });

  it('usuario nuevo: crea cuenta verificada sin contraseña y abre sesión de LUMENZA', async () => {
    const email = `g_${tag}_nuevo@example.com`;
    next = { sub: `sub-${tag}-1`, email, emailVerified: true, name: 'Gabriela Google' };
    const r = await callback(await begin(), 'code=good-code&state=state-123');
    expect(r.headers.location).toBe(`${ORIGIN}/inicio`);
    expect(sess(r)).toBe(true);
    const u = (await pool.query('SELECT email_verified, password_hash, google_sub FROM users WHERE email = $1', [email])).rows[0];
    expect(u).toMatchObject({ email_verified: true, password_hash: null, google_sub: `sub-${tag}-1` });
    const me = await request(app).get('/api/auth/me').set('Cookie', (r.headers['set-cookie'] as unknown as string[]).filter((c) => c.startsWith('lz_session=')));
    expect(me.body.user.email).toBe(email);
    // Segundo inicio con el mismo sub → misma cuenta
    const again = await callback(await begin(), 'code=good-code&state=state-123');
    expect(sess(again)).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM users WHERE google_sub = $1', [`sub-${tag}-1`])).rows[0].n).toBe(1);
  });

  it('cuenta local con correo VERIFICADO: se vincula y conserva su contraseña', async () => {
    const email = `g_${tag}_ver@example.com`;
    const hash = (await pool.query("SELECT 'x' AS x")).rows[0] && '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
    const id = (await pool.query('INSERT INTO users(email, username, password_hash, email_verified) VALUES ($1,$2,$3,true) RETURNING id', [email, `g_${tag}_ver`, hash])).rows[0].id;
    await pool.query('INSERT INTO profiles(user_id, display_name) VALUES ($1,$2)', [id, 'Local Verificada']);
    next = { sub: `sub-${tag}-2`, email, emailVerified: true };
    const r = await callback(await begin(), 'code=good-code&state=state-123');
    expect(sess(r)).toBe(true);
    const u = (await pool.query('SELECT google_sub, password_hash FROM users WHERE id = $1', [id])).rows[0];
    expect(u.google_sub).toBe(`sub-${tag}-2`);
    expect(u.password_hash).toBe(hash);
  });

  it('cuenta local con correo SIN verificar: al vincular se anula su contraseña y se revocan sus sesiones (anti pre-registro)', async () => {
    const email = `g_${tag}_unv@example.com`;
    const id = (await pool.query("INSERT INTO users(email, username, password_hash, email_verified) VALUES ($1,$2,'$argon2id$atacante',false) RETURNING id", [email, `g_${tag}_unv`])).rows[0].id;
    await pool.query('INSERT INTO profiles(user_id, display_name) VALUES ($1,$2)', [id, 'Pre-registro']);
    await pool.query("INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 day')", [id, `h_${tag}`]);
    next = { sub: `sub-${tag}-3`, email, emailVerified: true };
    const r = await callback(await begin(), 'code=good-code&state=state-123');
    expect(sess(r)).toBe(true);
    const u = (await pool.query('SELECT google_sub, password_hash, email_verified FROM users WHERE id = $1', [id])).rows[0];
    expect(u).toMatchObject({ google_sub: `sub-${tag}-3`, password_hash: null, email_verified: true });
    expect((await pool.query('SELECT revoked_at FROM sessions WHERE token_hash = $1', [`h_${tag}`])).rows[0].revoked_at).not.toBeNull();
  });

  it('Google con correo NO verificado: no crea ni vincula cuentas', async () => {
    const email = `g_${tag}_nv@example.com`;
    next = { sub: `sub-${tag}-4`, email, emailVerified: false };
    const r = await callback(await begin(), 'code=good-code&state=state-123');
    expect(r.headers.location).toContain('error=google_email_not_verified');
    expect(sess(r)).toBe(false);
    expect((await pool.query('SELECT 1 FROM users WHERE email = $1 OR google_sub = $2', [email, `sub-${tag}-4`])).rowCount).toBe(0);
  });

  it('config.google refleja el proveedor y, sin credenciales reales, queda deshabilitado', async () => {
    expect((await request(app).get('/api/auth/config')).body.google).toBe(true);
    const real = createApp();
    expect((await request(real).get('/api/auth/config')).body.google).toBe(false);
  });
});
