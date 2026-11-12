import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, cleanup, freeMfaStep, lastUsedMfaStep, makeAdmin, mfaFailureReasons, totpAtStep, totpNow, uniqueUser } from './helpers';

const emails: string[] = [];
test.afterAll(async () => {
  for (const e of emails) await cleanup(e);
});

const register = async (page: Page, prefix: string) => {
  const u = uniqueUser(prefix);
  emails.push(u.email);
  const r = await page.request.post(`${ORIGIN}/api/auth/register`, { headers: { Origin: ORIGIN }, data: { displayName: u.name, username: u.username, email: u.email, password: u.password, confirmPassword: u.password } });
  expect(r.status()).toBe(201);
  return u;
};
const api = (page: Page, url: string, data?: object) => page.request.post(`${ORIGIN}/api${url}`, { headers: { Origin: ORIGIN }, data });

/** Activa MFA por API (misma ruta que la UI) y devuelve secreto y códigos. */
async function enableByApi(page: Page, password: string) {
  const s = await (await api(page, '/auth/mfa/setup', { password })).json();
  const e = await (await api(page, '/auth/mfa/enable', { code: totpNow(s.secret) })).json();
  return { secret: s.secret as string, codes: e.recoveryCodes as string[] };
}

test('activación completa desde Ajustes: QR real, código inválido rechazado, códigos de recuperación y estado Activada', async ({ page }) => {
  const u = await register(page, 'mf1');
  await page.goto('/ajustes/seguridad');
  await expect(page.getByRole('heading', { name: 'Seguridad' })).toBeVisible();
  await expect(page.getByTestId('mfa-badge')).toHaveText(/Desactivada/);
  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Activar verificación en dos pasos' });
  await dlg.getByLabel('Confirma tu contraseña').fill('contraseña-equivocada-1');
  await dlg.getByRole('button', { name: 'Continuar' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Contraseña incorrecta');
  await dlg.getByLabel('Confirma tu contraseña').fill(u.password);
  await dlg.getByRole('button', { name: 'Continuar' }).click();

  const qr = page.getByTestId('mfa-qr');
  await expect(qr).toBeVisible();
  await expect.poll(() => qr.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(100); // QR real (PNG)
  const secret = ((await page.getByTestId('mfa-secret').textContent()) ?? '').replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  const input = page.getByLabel('Código de verificación');
  await expect(input).toHaveAttribute('autocomplete', 'one-time-code');
  await input.fill('000000');
  await expect(page.getByRole('alert').filter({ hasText: /no es válido/ })).toBeVisible();
  await input.fill(totpNow(secret)); // se envía solo al completar 6 dígitos

  const list = page.getByTestId('recovery-codes');
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(10);
  const done = page.getByRole('button', { name: 'Listo, ya los guardé' });
  await expect(done).toBeDisabled(); // hay que confirmar que se guardaron
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar .txt' }).click();
  expect((await download).suggestedFilename()).toBe('lumenza-codigos-de-recuperacion.txt');
  await page.getByLabel('He guardado mis códigos de recuperación').check();
  await done.click();

  await expect(page.getByTestId('mfa-badge')).toHaveText(/Activada/);
  await expect(page.getByTestId('recovery-remaining')).toHaveText('10 de 10 disponibles');
  await expect(page.getByRole('button', { name: 'Activar', exact: true })).toHaveCount(0);
});

test('login en dos pasos con TOTP: sin sesión tras la contraseña; código erróneo y reutilizado rechazados; el correcto entra', async ({ page }) => {
  const u = await register(page, 'mf2');
  const { secret } = await enableByApi(page, u.password);
  // Paso TOTP que el backend gastó al activar: todo lo demás se deriva de ESTE contador, no del reloj, así el test no depende de
  // en qué segundo de la ventana de 30 s ocurra (el servidor acepta ±1 paso respecto a su reloj, y la prueba dura < 30 s).
  const used = await lastUsedMfaStep(u.email);
  expect(used).not.toBeNull();
  const usedStep = used!;
  await api(page, '/auth/logout');

  await page.goto('/login');
  await page.getByLabel('Correo o usuario').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login\/mfa$/);
  expect((await page.request.get(`${ORIGIN}/api/auth/me`)).status()).toBe(401); // credenciales correctas, pero aún sin sesión
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login$/); // las rutas privadas siguen protegidas
  await page.getByLabel('Correo o usuario').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login\/mfa$/);

  const input = page.getByLabel('Código de verificación');
  await input.fill('123456'); // inválido
  await expect(page.getByRole('alert').filter({ hasText: /Te quedan 4 intentos/ })).toBeVisible();
  // Reutilización: EXACTAMENTE el código ya gastado en la activación (paso S). El contador de intentos restantes distingue cada
  // respuesta del servidor (un alert anterior no puede dar un falso positivo).
  await input.fill(totpAtStep(secret, usedStep));
  await expect(page.getByRole('alert').filter({ hasText: /Te quedan 3 intentos/ })).toBeVisible();
  // Caducado: el paso S-2 queda fuera de la ventana ±1 en cualquier instante de la prueba
  await input.fill(totpAtStep(secret, usedStep - 2));
  await expect(page.getByRole('alert').filter({ hasText: /Te quedan 2 intentos/ })).toBeVisible();
  // El backend los distingue en la auditoría: inválido, reutilizado, caducado (inválido)
  expect(await mfaFailureReasons(u.email)).toEqual(['bad_totp', 'totp_replay', 'bad_totp']);
  expect((await page.request.get(`${ORIGIN}/api/auth/me`)).status()).toBe(401); // ninguno de los rechazados abrió sesión
  // Código nuevo y válido: el paso S+1 es posterior al último usado y siempre cae dentro de la ventana
  await input.fill(totpAtStep(secret, usedStep + 1));
  await expect(page).toHaveURL(/\/inicio$/);
  expect((await page.request.get(`${ORIGIN}/api/auth/me`)).status()).toBe(200);
});

test('código de recuperación: entra una vez y se descuenta; el mismo código ya no sirve', async ({ page }) => {
  const u = await register(page, 'mf3');
  const { codes } = await enableByApi(page, u.password);
  const loginTo2fa = async () => {
    await api(page, '/auth/logout');
    await page.goto('/login');
    await page.getByLabel('Correo o usuario').fill(u.username);
    await page.getByLabel('Contraseña').fill(u.password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await expect(page).toHaveURL(/\/login\/mfa$/);
    await page.getByRole('button', { name: 'Usar un código de recuperación' }).click();
  };
  await loginTo2fa();
  await page.getByLabel('Código de recuperación').fill(codes[0]!.toLowerCase());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByText('Te quedan 9')).toBeVisible();

  await loginTo2fa();
  await page.getByLabel('Código de recuperación').fill(codes[0]!);
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /ya utilizado/ })).toBeVisible();
  await expect(page).toHaveURL(/\/login\/mfa$/);
});

test('desactivar y regenerar desde Ajustes exigen contraseña y factor; regenerar invalida los códigos anteriores', async ({ page }) => {
  const u = await register(page, 'mf4');
  const { secret, codes } = await enableByApi(page, u.password);
  await freeMfaStep(u.email);
  await page.goto('/ajustes/seguridad');
  await expect(page.getByTestId('mfa-badge')).toHaveText(/Activada/);

  // Regenerar con TOTP
  await page.getByRole('button', { name: 'Regenerar' }).click();
  const rg = page.getByRole('dialog', { name: 'Regenerar códigos de recuperación' });
  await expect(rg.getByRole('button', { name: 'Regenerar' })).toBeDisabled();
  await rg.getByLabel('Contraseña').fill('mala-clave-123');
  await rg.getByLabel('Código de tu aplicación').fill(totpNow(secret));
  await rg.getByRole('button', { name: 'Regenerar' }).click();
  await expect(rg.getByRole('alert')).toContainText('Contraseña incorrecta');
  await rg.getByLabel('Contraseña').fill(u.password);
  await rg.getByRole('button', { name: 'Regenerar' }).click();
  const fresh = page.getByTestId('recovery-codes');
  await expect(fresh.getByRole('listitem')).toHaveCount(10);
  const newCodes = await fresh.getByRole('listitem').allTextContents();
  expect(newCodes).not.toContain(codes[0]);
  await page.getByLabel('He guardado mis códigos de recuperación').check();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();

  // Desactivar con un código de recuperación nuevo como factor
  await page.getByRole('button', { name: 'Desactivar', exact: true }).click();
  const dd = page.getByRole('dialog', { name: 'Desactivar verificación en dos pasos' });
  await dd.getByLabel('Contraseña').fill(u.password);
  await dd.getByRole('button', { name: 'Usar un código de recuperación' }).click();
  await dd.getByLabel('Código de recuperación').fill(codes[1]!); // un código ANTERIOR ya no vale
  await dd.getByRole('button', { name: 'Desactivar' }).click();
  await expect(dd.getByRole('alert')).toContainText(/incorrecto o ya utilizado/);
  await dd.getByLabel('Código de recuperación').fill(newCodes[1]!);
  await dd.getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByText('Verificación en dos pasos desactivada')).toBeVisible();
  await expect(page.getByTestId('mfa-badge')).toHaveText(/Desactivada/);
});

test('administrador: MFA obligatorio — se le dirige a Ajustes, no accede al resto hasta activarlo y no puede desactivarlo', async ({ page }) => {
  const u = await register(page, 'mf5');
  await makeAdmin(u.email);
  await api(page, '/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Correo o usuario').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/ajustes\/seguridad$/);
  await expect(page.getByRole('alert').filter({ hasText: /obligatoria para administradores/ })).toBeVisible();
  expect((await page.request.get(`${ORIGIN}/api/feed`)).status()).toBe(403); // el resto de la API está bloqueado
  await page.goto('/inicio'); // el frontend lo devuelve a Ajustes
  await expect(page).toHaveURL(/\/ajustes\/seguridad$/);

  await page.getByRole('button', { name: 'Activar', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'Activar verificación en dos pasos' });
  await dlg.getByLabel('Confirma tu contraseña').fill(u.password);
  await dlg.getByRole('button', { name: 'Continuar' }).click();
  const secret = ((await page.getByTestId('mfa-secret').textContent()) ?? '').replace(/\s/g, '');
  await page.getByLabel('Código de verificación').fill(totpNow(secret));
  await page.getByLabel('He guardado mis códigos de recuperación').check();
  await page.getByRole('button', { name: 'Listo, ya los guardé' }).click();
  expect((await page.request.get(`${ORIGIN}/api/feed`)).status()).toBe(200); // acceso restaurado
  await expect(page.getByRole('button', { name: 'Desactivar', exact: true })).toHaveCount(0);
  await expect(page.getByText('No se puede desactivar: es obligatoria para tu rol.')).toBeVisible();
});

test('desafío caducado: mensaje claro y vuelta al inicio de sesión', async ({ page }) => {
  const u = await register(page, 'mf6');
  await enableByApi(page, u.password);
  await api(page, '/auth/logout');
  await api(page, '/auth/login', { identifier: u.email, password: u.password }); // deja el desafío en la cookie
  const { sql } = await import('./helpers');
  await sql("UPDATE mfa_challenges SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [u.email]);
  await page.goto('/login/mfa');
  await expect(page.getByRole('heading', { name: 'La verificación expiró' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

for (const w of [320, 375, 768, 1024, 1440]) {
  test(`responsive ${w}px: Ajustes de seguridad, asistente y paso MFA sin desbordamiento (oscuro y claro)`, async ({ page }) => {
    const u = await register(page, `mr${w}`);
    await page.setViewportSize({ width: w, height: 900 });
    const overflow = async (label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(0);
    const themes = async (fn: () => Promise<void>) => {
      for (const scheme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.evaluate((s) => { localStorage.setItem('lumenza-theme', s); document.documentElement.dataset.theme = s; }, scheme);
        await fn();
      }
    };

    await page.goto('/ajustes/seguridad');
    await expect(page.getByRole('button', { name: 'Activar', exact: true })).toBeVisible();
    await themes(async () => overflow(`ajustes desactivada @${w}`));

    await page.getByRole('button', { name: 'Activar', exact: true }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Confirma tu contraseña').fill(u.password);
    await dlg.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByTestId('mfa-qr')).toBeVisible();
    await themes(async () => {
      await overflow(`asistente @${w}`);
      const box = (await page.getByRole('dialog').boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(w + 1);
      await expect(page.getByLabel('Código de verificación')).toBeVisible();
    });
    const secret = ((await page.getByTestId('mfa-secret').textContent()) ?? '').replace(/\s/g, '');
    await page.getByLabel('Código de verificación').fill(totpNow(secret));
    await expect(page.getByTestId('recovery-codes')).toBeVisible();
    await themes(async () => overflow(`códigos @${w}`));
    await page.getByLabel('He guardado mis códigos de recuperación').check();
    await page.getByRole('button', { name: 'Listo, ya los guardé' }).click();
    await themes(async () => overflow(`ajustes activada @${w}`));

    // Paso MFA del login (el desafío queda en la cookie)
    await api(page, '/auth/logout');
    await api(page, '/auth/login', { identifier: u.email, password: u.password });
    await page.goto('/login/mfa');
    await expect(page.getByLabel('Código de verificación')).toBeVisible();
    await themes(async () => overflow(`login mfa @${w}`));
  });
}
