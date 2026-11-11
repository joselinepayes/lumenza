// Integración REAL contra PostgreSQL: MFA TOTP. El TOTP de las pruebas es una implementación independiente (RFC 6238) que
// no usa la librería del servidor. El proveedor de Google está inyectado (prueba la LÓGICA de integración con MFA, no a Google).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN } from '../../test/helpers.js';
import { totpNow } from '../../test/totp.js';
import type { GoogleClaims, GoogleProvider } from '../auth/google.js';

const run = process.env.INTEGRATION === '1';
const PW = 'Clave-segura-123';
const NEW_PW = 'Otra-clave-segura-456';

describe.skipIf(!run)('MFA TOTP (PostgreSQL real)', async () => {
  const { createApp } = await import('../../app.js');
  const { pool } = await import('../../db/pool.js');
  const { env } = await import('../../config/env.js');
  const mails: { to: string; text: string }[] = [];
  let nextGoogle: GoogleClaims = { sub: 'x', email: 'x@example.com', emailVerified: true };
  const google: GoogleProvider = {
    enabled: true,
    start: () => ({ url: 'https://accounts.google.example/auth', state: 'st', verifier: 'v', nonce: 'n' }),
    exchange: async () => nextGoogle,
  };
  const app = createApp({ mailer: { send: async (m) => void mails.push({ to: m.to, text: m.text }) }, google });
  const strictApp = createApp({ strictLimits: true });
  const tag = `${Date.now().toString(36)}m`;
  let counter = 0;

  const cookieOf = (res: request.Response, name: string) => ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith(`${name}=`))?.split(';')[0];
  const attrsOf = (res: request.Response, name: string) => ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith(`${name}=`)) ?? '';
  const post = (url: string, body?: object, cookies: (string | undefined)[] = []) => request(app).post(url).set('Origin', ORIGIN).set('Cookie', cookies.filter(Boolean) as string[]).send(body);
  const get = (url: string, cookies: (string | undefined)[] = []) => request(app).get(url).set('Cookie', cookies.filter(Boolean) as string[]);

  async function newUser() {
    const n = ++counter;
    const u = { username: `m${n}_${tag}`, email: `m${n}_${tag}@example.com`, id: '', session: '' };
    const r = await post('/api/auth/register', { displayName: `Mfa ${n}`, username: u.username, email: u.email, password: PW, confirmPassword: PW });
    u.id = r.body.user.id;
    u.session = cookieOf(r, 'lz_session')!;
    return u;
  }
  type U = Awaited<ReturnType<typeof newUser>>;
  /** Activa MFA para el usuario; devuelve secreto y códigos de recuperación. */
  async function enableMfa(u: U, password = PW) {
    const s = await post('/api/auth/mfa/setup', { password }, [u.session]);
    expect(s.status).toBe(200);
    const e = await post('/api/auth/mfa/enable', { code: totpNow(s.body.secret) }, [u.session]);
    expect(e.status).toBe(200);
    return { secret: s.body.secret as string, codes: e.body.recoveryCodes as string[] };
  }
  const login = (u: U, password = PW) => post('/api/auth/login', { identifier: u.email, password });
  const freeStep = (id: string) => pool.query('UPDATE user_mfa SET last_used_step = NULL WHERE user_id = $1', [id]); // simula el paso de 30 s
  const clearFailures = (id: string) => pool.query("DELETE FROM audit_log WHERE user_id = $1 AND action = 'auth.mfa_failed'", [id]);
  const lastToken = (to: string) => mails.filter((m) => m.to === to).at(-1)!.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;

  beforeAll(async () => { /* los usuarios se crean por prueba */ });
  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`m%_${tag}%`]);
    await pool.query("DELETE FROM users WHERE email = $1", [`mgoogle_${tag}@example.com`]);
    await pool.end();
  });

  it('setup: exige sesión, CSRF y contraseña; devuelve secreto, URL otpauth y QR; el secreto se guarda CIFRADO', async () => {
    const u = await newUser();
    expect((await request(app).post('/api/auth/mfa/setup').send({})).status).toBe(403); // CSRF (sin Origin)
    expect((await post('/api/auth/mfa/setup', { password: PW })).status).toBe(401); // sin sesión
    const bad = await post('/api/auth/mfa/setup', { password: 'mala-clave-1' }, [u.session]);
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('invalid_password');
    expect((await post('/api/auth/mfa/setup', {}, [u.session])).status).toBe(401); // contraseña ausente

    const ok = await post('/api/auth/mfa/setup', { password: PW }, [u.session]);
    expect(ok.status).toBe(200);
    expect(ok.body.secret).toMatch(/^[A-Z2-7]{32}$/); // 160 bits en base32
    const url = new URL(ok.body.otpauthUrl);
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe(`/LUMENZA:${u.email}`);
    expect(url.searchParams.get('secret')).toBe(ok.body.secret);
    expect(url.searchParams.get('issuer')).toBe('LUMENZA');
    expect(ok.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(ok.body.qrDataUrl.split(',')[1], 'base64').subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG real

    const row = (await pool.query('SELECT secret_enc, pending FROM user_mfa WHERE user_id = $1', [u.id])).rows[0];
    expect(row.pending).toBe(true);
    expect(row.secret_enc).toMatch(/^v1\./);
    expect(row.secret_enc).not.toContain(ok.body.secret);
    expect((await get('/api/auth/mfa/status', [u.session])).body).toMatchObject({ available: true, enabled: false });
  });

  it('enable: código inválido rechazado; válido activa MFA, entrega 10 códigos (solo HMAC en BD) y cierra las demás sesiones', async () => {
    const u = await newUser();
    const other = cookieOf(await login(u), 'lz_session')!; // segunda sesión
    expect((await get('/api/auth/me', [other])).status).toBe(200);
    const s = await post('/api/auth/mfa/setup', { password: PW }, [u.session]);
    expect((await post('/api/auth/mfa/enable', { code: '000000' }, [u.session])).body.error.code).toBe('invalid_code');
    expect((await post('/api/auth/mfa/enable', { code: '12' }, [u.session])).status).toBe(400);
    expect((await get('/api/auth/mfa/status', [u.session])).body.enabled).toBe(false); // sin código válido no se activa

    const e = await post('/api/auth/mfa/enable', { code: totpNow(s.body.secret) }, [u.session]);
    expect(e.status).toBe(200);
    expect(e.body.recoveryCodes).toHaveLength(10);
    for (const c of e.body.recoveryCodes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const st = (await get('/api/auth/mfa/status', [u.session])).body;
    expect(st).toMatchObject({ enabled: true, recoveryRemaining: 10 });
    expect((await get('/api/auth/me', [u.session])).body.user.mfaEnabled).toBe(true);
    expect((await get('/api/auth/me', [other])).status).toBe(401); // otras sesiones cerradas

    const hashes = (await pool.query('SELECT code_hash FROM mfa_recovery_codes WHERE user_id = $1', [u.id])).rows.map((r) => r.code_hash);
    expect(hashes).toHaveLength(10);
    for (const c of e.body.recoveryCodes) expect(hashes).not.toContain(c); // nunca en claro
    expect(JSON.stringify(hashes)).not.toMatch(/[A-HJ-NP-Z2-9]{5}-/);
    expect((await post('/api/auth/mfa/setup', { password: PW }, [u.session])).status).toBe(409); // ya activo
  });

  it('login en dos pasos: contraseña correcta NO abre sesión; TOTP válido sí; reutilización rechazada; deriva ±1 paso aceptada', async () => {
    const u = await newUser();
    const { secret } = await enableMfa(u);
    const r = await login(u);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ mfaRequired: true });
    expect(cookieOf(r, 'lz_session')).toBeUndefined();
    const ch = cookieOf(r, 'lz_mfa')!;
    expect(attrsOf(r, 'lz_mfa')).toMatch(/HttpOnly/i);
    expect(attrsOf(r, 'lz_mfa')).toMatch(/Path=\/api\/auth\/mfa/);
    expect((await get('/api/auth/me')).status).toBe(401);
    expect((await get('/api/auth/mfa/challenge', [ch])).body).toMatchObject({ valid: true, source: 'password', attemptsLeft: 5 });
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) })).body.error.code).toBe('challenge_expired'); // sin cookie del desafío

    // Se activó con el código del paso actual: ese mismo paso ya está usado → reutilización rechazada
    const replay = await post('/api/auth/mfa/verify', { code: totpNow(secret, 0) }, [ch]);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('invalid_code');
    // El código del paso SIGUIENTE (deriva de reloj +30 s) cae dentro de la ventana permitida y es válido
    const ok = await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) }, [ch]);
    expect(ok.status).toBe(200);
    expect(ok.body.method).toBe('totp');
    const session = cookieOf(ok, 'lz_session')!;
    expect(attrsOf(ok, 'lz_session')).toMatch(/HttpOnly/i);
    expect((await get('/api/auth/me', [session])).body.user.username).toBe(u.username);
    expect(cookieOf(ok, 'lz_mfa')).toBe('lz_mfa='); // el desafío se invalida (cookie limpiada)
    expect((await pool.query('SELECT mfa_verified_at FROM sessions WHERE token_hash IS NOT NULL AND user_id = $1 ORDER BY created_at DESC LIMIT 1', [u.id])).rows[0].mfa_verified_at).not.toBeNull();

    // Un código ya usado no sirve ni con un desafío nuevo
    const ch2 = cookieOf(await login(u), 'lz_mfa')!;
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) }, [ch2])).body.error.code).toBe('invalid_code');
    // El desafío usado no puede repetirse
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) }, [ch])).body.error.code).toBe('challenge_expired');
    // Fuera de la ventana (±1 paso) no vale: +3 pasos
    await freeStep(u.id);
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret, 3) }, [ch2])).body.error.code).toBe('invalid_code');
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret, -1) }, [ch2])).status).toBe(200); // paso anterior (deriva −30 s)
  });

  it('fuerza bruta: 5 fallos matan el desafío; 10 fallos bloquean al usuario 15 min incluso con código correcto', async () => {
    const u = await newUser();
    const { secret } = await enableMfa(u);
    await freeStep(u.id);
    let ch = cookieOf(await login(u), 'lz_mfa')!;
    const left: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await post('/api/auth/mfa/verify', { code: '000000' }, [ch]);
      expect(r.status).toBe(401);
      left.push(r.body.error.message.match(/(\d) intentos/)?.[1]);
    }
    expect(left).toEqual(['4', '3', '2', '1']);
    const fifth = await post('/api/auth/mfa/verify', { code: '000000' }, [ch]);
    expect(fifth.body.error.code).toBe('challenge_expired'); // el desafío queda inutilizado
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret) }, [ch])).body.error.code).toBe('challenge_expired'); // ni siquiera con el código correcto

    // 5 fallos más con otro desafío → 10 fallos recientes → bloqueo del usuario
    ch = cookieOf(await login(u), 'lz_mfa')!;
    for (let i = 0; i < 4; i++) await post('/api/auth/mfa/verify', { code: '111111' }, [ch]);
    await post('/api/auth/mfa/verify', { code: '111111' }, [ch]);
    const ch3 = cookieOf(await login(u), 'lz_mfa')!;
    const locked = await post('/api/auth/mfa/verify', { code: totpNow(secret) }, [ch3]); // código CORRECTO, pero bloqueado
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('mfa_locked');
    expect(cookieOf(locked, 'lz_session')).toBeUndefined();
    // los intentos de activación/desactivación también respetan el bloqueo
    expect((await post('/api/auth/mfa/disable', { password: PW, code: totpNow(secret) }, [u.session])).status).toBe(429);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1 AND action = 'auth.mfa_locked'", [u.id])).rows[0].n).toBeGreaterThan(0);
    await clearFailures(u.id); // pasan los 15 minutos
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret) }, [ch3])).status).toBe(200);
  });

  it('códigos de recuperación: un solo uso, insensibles a mayúsculas/espacios y se descuentan', async () => {
    const u = await newUser();
    const { codes } = await enableMfa(u);
    const c1 = cookieOf(await login(u), 'lz_mfa')!;
    const spaced = codes[0]!.toLowerCase().replace('-', ' ');
    const ok = await post('/api/auth/mfa/verify', { recoveryCode: spaced }, [c1]);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ method: 'recovery', recoveryRemaining: 9 });
    const s = cookieOf(ok, 'lz_session')!;
    expect((await get('/api/auth/mfa/status', [s])).body.recoveryRemaining).toBe(9);
    const c2 = cookieOf(await login(u), 'lz_mfa')!;
    const again = await post('/api/auth/mfa/verify', { recoveryCode: codes[0] }, [c2]);
    expect(again.status).toBe(401); // ya usado
    expect(again.body.error.code).toBe('invalid_code');
    expect((await post('/api/auth/mfa/verify', { recoveryCode: 'AAAAA-BBBBB' }, [c2])).status).toBe(401);
    expect((await post('/api/auth/mfa/verify', { recoveryCode: codes[1] }, [c2])).status).toBe(200);
  });

  it('desafío caducado → challenge_expired; los usuarios sin MFA siguen entrando directamente', async () => {
    const u = await newUser();
    const { secret } = await enableMfa(u);
    await freeStep(u.id);
    const ch = cookieOf(await login(u), 'lz_mfa')!;
    await pool.query("UPDATE mfa_challenges SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND consumed_at IS NULL", [u.id]);
    expect((await get('/api/auth/mfa/challenge', [ch])).status).toBe(401);
    expect((await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) }, [ch])).body.error.code).toBe('challenge_expired');
    const plain = await newUser();
    const r = await login(plain);
    expect(cookieOf(r, 'lz_session')).toBeDefined();
    expect(r.body.user.mfaEnabled).toBe(false);
  });

  it('limitación por IP (límites reales): el segundo paso y la activación devuelven 429 tras 10 solicitudes', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await request(strictApp).post('/api/auth/mfa/verify').set('Origin', ORIGIN).send({ code: '123456' })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it('Google OAuth NO omite el MFA: el callback exige el segundo factor y no abre sesión', async () => {
    const u = await newUser();
    const { secret } = await enableMfa(u);
    await freeStep(u.id);
    await pool.query('UPDATE users SET google_sub = $2 WHERE id = $1', [u.id, `sub-${tag}-m`]);
    nextGoogle = { sub: `sub-${tag}-m`, email: u.email, emailVerified: true };
    const start = await request(app).get('/api/auth/google');
    const oauth = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lz_oauth='))!.split(';')[0]!;
    const cb = await request(app).get('/api/auth/google/callback?code=c&state=st').set('Cookie', oauth);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`${ORIGIN}/login/mfa`);
    expect(cookieOf(cb, 'lz_session')).toBeUndefined();
    const ch = cookieOf(cb, 'lz_mfa')!;
    expect((await get('/api/auth/me')).status).toBe(401);
    expect((await get('/api/auth/mfa/challenge', [ch])).body.source).toBe('google');
    const ok = await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) }, [ch]);
    expect(ok.status).toBe(200);
    expect(cookieOf(ok, 'lz_session')).toBeDefined();
    expect((await pool.query("SELECT meta->>'source' AS s FROM audit_log WHERE user_id = $1 AND action = 'auth.mfa_login' ORDER BY id DESC LIMIT 1", [u.id])).rows[0].s).toBe('google');
  });

  it('cuenta solo-Google (sin contraseña): reautenticación reciente (sesión ≤ 10 min) en lugar de contraseña', async () => {
    nextGoogle = { sub: `sub-${tag}-g`, email: `mgoogle_${tag}@example.com`, emailVerified: true, name: 'Solo Google' };
    const start = await request(app).get('/api/auth/google');
    const oauth = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lz_oauth='))!.split(';')[0]!;
    const cb = await request(app).get('/api/auth/google/callback?code=c&state=st').set('Cookie', oauth);
    const session = cookieOf(cb, 'lz_session')!;
    expect(session).toBeDefined();
    const st = (await get('/api/auth/mfa/status', [session])).body;
    expect(st.needsPassword).toBe(false);
    await pool.query("UPDATE sessions SET created_at = now() - interval '1 hour' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [`mgoogle_${tag}@example.com`]);
    const old = await post('/api/auth/mfa/setup', {}, [session]);
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('reauth_required');
    await pool.query("UPDATE sessions SET created_at = now() WHERE user_id = (SELECT id FROM users WHERE email = $1)", [`mgoogle_${tag}@example.com`]);
    expect((await post('/api/auth/mfa/setup', {}, [session])).status).toBe(200);
  });

  it('desactivar y regenerar exigen contraseña Y un factor válido; revocan otras sesiones y los códigos anteriores', async () => {
    const u = await newUser();
    const { secret, codes } = await enableMfa(u);
    await freeStep(u.id);
    expect((await post('/api/auth/mfa/disable', { code: totpNow(secret, 1) }, [u.session])).status).toBe(401); // sin contraseña
    expect((await post('/api/auth/mfa/disable', { password: 'mala-clave-1', code: totpNow(secret, 1) }, [u.session])).body.error.code).toBe('invalid_password');
    expect((await post('/api/auth/mfa/disable', { password: PW, code: '000000' }, [u.session])).body.error.code).toBe('invalid_code');
    expect((await post('/api/auth/mfa/disable', { password: PW }, [u.session])).status).toBe(400); // sin factor
    expect((await get('/api/auth/mfa/status', [u.session])).body.enabled).toBe(true);

    // Regenerar: invalida los 10 códigos anteriores
    const r = await post('/api/auth/mfa/recovery-codes/regenerate', { password: PW, code: totpNow(secret, 1) }, [u.session]);
    expect(r.status).toBe(200);
    expect(r.body.recoveryCodes).toHaveLength(10);
    expect(r.body.recoveryCodes).not.toEqual(expect.arrayContaining([codes[0]]));
    const c1 = cookieOf(await login(u), 'lz_mfa')!;
    expect((await post('/api/auth/mfa/verify', { recoveryCode: codes[0] }, [c1])).status).toBe(401); // el código viejo ya no sirve
    const second = cookieOf(await post('/api/auth/mfa/verify', { recoveryCode: r.body.recoveryCodes[0] }, [c1]), 'lz_session')!; // otra sesión (con un código nuevo)
    expect(second).toBeDefined();

    // Desactivar con un código de recuperación como factor autorizado
    const d = await post('/api/auth/mfa/disable', { password: PW, recoveryCode: r.body.recoveryCodes[1] }, [u.session]);
    expect(d.status).toBe(204);
    expect((await get('/api/auth/me', [second])).status).toBe(401); // otras sesiones cerradas
    expect((await get('/api/auth/me', [u.session])).body.user.mfaEnabled).toBe(false);
    expect((await pool.query('SELECT 1 FROM user_mfa WHERE user_id = $1', [u.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM mfa_recovery_codes WHERE user_id = $1', [u.id])).rowCount).toBe(0);
    const after = await login(u);
    expect(cookieOf(after, 'lz_session')).toBeDefined(); // vuelve a entrar sin segundo factor
  });

  it('restablecer la contraseña por correo NO desactiva el MFA (el login sigue exigiendo el segundo factor)', async () => {
    const u = await newUser();
    await enableMfa(u);
    await post('/api/auth/forgot-password', { email: u.email });
    const token = lastToken(u.email);
    expect((await post('/api/auth/reset-password', { token, password: NEW_PW, confirmPassword: NEW_PW })).status).toBe(200);
    const r = await login(u, NEW_PW);
    expect(r.body).toEqual({ mfaRequired: true });
    expect(cookieOf(r, 'lz_session')).toBeUndefined();
  });

  it('administradores: MFA obligatorio (sesión de alcance limitado hasta enrolar; no pueden desactivarlo)', async () => {
    const u = await newUser();
    await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.id]);
    const r = await login(u);
    expect(r.status).toBe(200);
    expect(r.body.mfaEnrollmentRequired).toBe(true);
    const s = cookieOf(r, 'lz_session')!;
    expect((await get('/api/auth/me', [s])).body).toMatchObject({ sessionScope: 'mfa_setup', user: { mfaRequired: true, mfaEnabled: false } });
    const blocked = await get('/api/feed', [s]);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('mfa_enrollment_required');
    expect((await get('/api/explore', [s])).status).toBe(403);

    const setup = await post('/api/auth/mfa/setup', { password: PW }, [s]); // sí puede enrolar
    expect(setup.status).toBe(200);
    expect((await post('/api/auth/mfa/enable', { code: totpNow(setup.body.secret) }, [s])).status).toBe(200);
    expect((await get('/api/feed', [s])).status).toBe(200); // la sesión pasa a alcance completo
    expect((await get('/api/auth/me', [s])).body.sessionScope).toBe('full');

    const d = await post('/api/auth/mfa/disable', { password: PW, code: totpNow(setup.body.secret, 1) }, [s]);
    expect(d.status).toBe(403);
    expect(d.body.error.code).toBe('mfa_required_for_admin');
    expect((await login(u)).body).toEqual({ mfaRequired: true }); // y el login ya exige TOTP
  });

  it('administrador vía Google sin MFA: sesión de enrolamiento y redirección a Ajustes de seguridad', async () => {
    const u = await newUser();
    await pool.query("UPDATE users SET role = 'admin', google_sub = $2 WHERE id = $1", [u.id, `sub-${tag}-adm`]);
    nextGoogle = { sub: `sub-${tag}-adm`, email: u.email, emailVerified: true };
    const start = await request(app).get('/api/auth/google');
    const oauth = (start.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('lz_oauth='))!.split(';')[0]!;
    const cb = await request(app).get('/api/auth/google/callback?code=c&state=st').set('Cookie', oauth);
    expect(cb.headers.location).toBe(`${ORIGIN}/ajustes/seguridad`);
    expect((await get('/api/auth/me', [cookieOf(cb, 'lz_session')])).body.sessionScope).toBe('mfa_setup');
    expect((await get('/api/feed', [cookieOf(cb, 'lz_session')])).status).toBe(403);
  });

  it('sin clave de cifrado el MFA queda deshabilitado de forma explícita (no hay clave por defecto)', async () => {
    const u = await newUser();
    const saved = env.MFA_ENCRYPTION_KEY;
    env.MFA_ENCRYPTION_KEY = undefined;
    try {
      expect((await get('/api/auth/config')).body.mfa).toBe(false);
      const r = await post('/api/auth/mfa/setup', { password: PW }, [u.session]);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('mfa_not_configured');
    } finally {
      env.MFA_ENCRYPTION_KEY = saved;
    }
  });

  it('auditoría: los eventos MFA quedan registrados sin secretos ni códigos', async () => {
    const u = await newUser();
    const { secret, codes } = await enableMfa(u);
    await freeStep(u.id);
    const ch = cookieOf(await login(u), 'lz_mfa')!;
    await post('/api/auth/mfa/verify', { code: '000000' }, [ch]);
    await post('/api/auth/mfa/verify', { code: totpNow(secret, 1) }, [ch]);
    const rows = (await pool.query('SELECT action, meta::text AS meta, ip::text FROM audit_log WHERE user_id = $1', [u.id])).rows;
    const actions = rows.map((r) => r.action);
    for (const a of ['auth.mfa_setup_started', 'auth.mfa_enabled', 'auth.mfa_challenge', 'auth.mfa_failed', 'auth.mfa_login']) expect(actions).toContain(a);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(secret);
    for (const c of codes) expect(blob).not.toContain(c);
    expect(blob).not.toMatch(/000000|otpauth/);
  });
});
