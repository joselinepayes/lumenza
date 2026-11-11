import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, cleanup, tokenFromMail, uniqueUser } from './helpers';

const emails: string[] = [];
test.afterAll(async () => {
  for (const e of emails) await cleanup(e);
});

async function register(page: Page, u: ReturnType<typeof uniqueUser>) {
  emails.push(u.email);
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(u.name);
  await page.getByLabel('Nombre de usuario').fill(u.username);
  await expect(page.getByText('Nombre de usuario disponible')).toBeVisible();
  await page.getByLabel('Correo').fill(u.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(u.password);
  await page.getByLabel('Confirmar contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
}

test('ruta protegida redirige a login sin sesión', async ({ page }) => {
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login$/);
});

test('registro → verificación de correo real → logout → login', async ({ page }) => {
  const u = uniqueUser('e2e');
  await register(page, u);
  await expect(page.getByRole('heading', { name: 'Tu galería está en blanco' })).toBeVisible();
  await expect(page.getByText('Confirma tu correo')).toBeVisible();

  const token = await tokenFromMail(u.email, 'Confirma tu correo');
  await page.goto(`/verificar-correo?token=${token}`);
  await expect(page.getByRole('heading', { name: 'Correo confirmado' })).toBeVisible();
  expect(page.url()).not.toContain('token='); // el token se retira de la URL

  await page.goto('/inicio');
  await expect(page.getByRole('heading', { name: 'Tu galería está en blanco' })).toBeVisible();
  await expect(page.getByText('Confirma tu correo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/inicio');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Correo o usuario').fill(u.username);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test('login con contraseña incorrecta muestra error genérico', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo o usuario').fill('nadie@example.com');
  await page.getByLabel('Contraseña').fill('incorrecta-123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('alert')).toHaveText('Credenciales incorrectas');
});

test('enlace de verificación inválido muestra el mensaje adecuado', async ({ page }) => {
  await page.goto('/verificar-correo?token=' + 'a'.repeat(43));
  await expect(page.getByRole('heading', { name: 'El enlace no es válido' })).toBeVisible();
});

test('recuperación de contraseña de extremo a extremo y revocación de sesiones', async ({ page, browser }) => {
  const u = uniqueUser('rec');
  await register(page, u);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  // Una sesión abierta en otro navegador debe morir al restablecer
  const other = await browser.newContext();
  const login = await other.request.post(`${ORIGIN}/api/auth/login`, { headers: { Origin: ORIGIN }, data: { identifier: u.email, password: u.password } });
  expect(login.status()).toBe(200);
  expect((await other.request.get(`${ORIGIN}/api/auth/me`)).status()).toBe(200);

  await page.goto('/login');
  await page.getByRole('link', { name: '¿Olvidaste tu contraseña?' }).click();
  await expect(page).toHaveURL(/\/recuperar$/);
  await page.getByLabel('Correo').fill(u.email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

  const token = await tokenFromMail(u.email, 'Restablece tu contraseña');
  await page.goto(`/restablecer?token=${token}`);
  await expect(page.getByRole('heading', { name: 'Nueva contraseña' })).toBeVisible();
  const nueva = 'Otra-Clave-E2E-9';
  await page.getByLabel('Nueva contraseña').fill(nueva);
  await page.getByLabel('Confirmar contraseña').fill(nueva);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Contraseña actualizada' })).toBeVisible();

  expect((await other.request.get(`${ORIGIN}/api/auth/me`)).status()).toBe(401);
  await other.close();

  // El mismo enlace ya no sirve
  await page.goto(`/restablecer?token=${token}`);
  await expect(page.getByRole('heading', { name: 'Este enlace ya fue utilizado' })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Correo o usuario').fill(u.email);
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('alert')).toHaveText('Credenciales incorrectas');
  await page.getByLabel('Contraseña').fill(nueva);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});
