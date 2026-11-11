import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, cleanup, jpegBuffer, uniqueUser } from './helpers';

const emails: string[] = [];
test.afterAll(async () => {
  for (const e of emails) await cleanup(e);
});

const reg = (u: ReturnType<typeof uniqueUser>) => ({ displayName: u.name, username: u.username, email: u.email, password: u.password, confirmPassword: u.password });

test('publicar, interactuar, perfil, explorar, seguir y eliminar (flujo social completo)', async ({ page, browser }) => {
  const a = uniqueUser('soa');
  const b = uniqueUser('sob');
  emails.push(a.email, b.email);
  const tag = `luz${Date.now().toString(36)}`;

  // A se registra por la UI y publica una fotografía real
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(a.name);
  await page.getByLabel('Nombre de usuario').fill(a.username);
  await page.getByLabel('Correo').fill(a.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(a.password);
  await page.getByLabel('Confirmar contraseña').fill(a.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/inicio$/);

  await page.getByRole('button', { name: 'Nueva publicación' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nueva publicación' });
  // Validación en cliente: archivo que no es imagen
  await dialog.locator('input[type=file]').setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  await expect(dialog.getByRole('alert')).toContainText('Formato no admitido');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: await jpegBuffer() });
  await dialog.getByLabel('Descripción').fill('Primera luz de la mañana');
  await dialog.getByLabel('Etiquetas').fill(`${tag} montaña`);
  await dialog.getByLabel('Categoría').selectOption('naturaleza');
  await dialog.getByRole('button', { name: 'Publicar' }).click();
  await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.getByText('Primera luz de la mañana').first()).toBeVisible();
  // El procesamiento es asíncrono: aparece LUMENZA Studio cuando el worker termina (sin recargar)
  await expect(page.getByRole('radiogroup', { name: 'Versiones de la fotografía' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('img', { name: /Original: Primera luz/ })).toBeVisible();
  const postUrl = page.url();

  // La imagen se carga de verdad (naturalWidth > 0), servida desde el almacenamiento
  await expect.poll(() => page.getByRole('img', { name: /Original: Primera luz/ }).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

  // Feed: like, guardar y comentar con estado real
  await page.goto('/inicio');
  const card = page.getByRole('article', { name: `Publicación de ${a.username}` });
  await expect(card.getByText('Primera luz de la mañana')).toBeVisible();
  await card.getByRole('button', { name: 'Me gusta' }).click();
  await expect(card.getByRole('button', { name: 'Quitar me gusta' })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByText('1 me gusta')).toBeVisible();
  await card.getByRole('button', { name: 'Guardar' }).click();
  await expect(card.getByRole('button', { name: 'Quitar de guardados' })).toBeVisible();
  await card.getByLabel('Añadir comentario').fill('Un comentario de prueba');
  await card.getByRole('button', { name: 'Publicar' }).click();
  await expect(card.getByText('Ver 1 comentario')).toBeVisible();

  // Perfil: pestaña de guardados (solo dueño)
  await page.goto(`/u/${a.username}`);
  await expect(page.getByRole('heading', { name: a.name })).toBeVisible();
  await page.getByRole('tab', { name: /Guardados/ }).click();
  await expect(page.getByRole('link', { name: /Abrir publicación/ })).toHaveCount(1);

  // Explorar: categoría, etiqueta y búsqueda
  await page.goto('/explorar?cat=naturaleza');
  await expect(page.getByRole('link', { name: /Fotografía de/ }).first()).toBeVisible();
  await page.goto(`/explorar?tag=${tag}`);
  await expect(page.getByRole('link', { name: /Fotografía de/ })).toHaveCount(1);
  await page.goto('/explorar');
  await page.getByLabel('Buscar').fill('mañana');
  await expect(page.getByRole('link', { name: /Fotografía de/ })).toHaveCount(1);
  await page.getByLabel('Buscar').fill('zzzzsinresultados');
  await expect(page.getByRole('heading', { name: 'Sin resultados' })).toBeVisible();

  // B (otro navegador): sigue a A y ve su publicación en el feed
  const ctxB = await browser.newContext();
  const regB = await ctxB.request.post(`${ORIGIN}/api/auth/register`, { headers: { Origin: ORIGIN }, data: reg(b) });
  expect(regB.status()).toBe(201);
  const pb: Page = await ctxB.newPage();
  await pb.goto(`/u/${a.username}`);
  await expect(pb.getByRole('heading', { name: a.name })).toBeVisible();
  await expect(pb.getByRole('button', { name: 'Editar perfil' })).toHaveCount(0); // no puede editar perfiles ajenos
  const main = pb.getByRole('main');
  await main.getByRole('button', { name: `Seguir a ${a.username}` }).click();
  await expect(main.getByRole('button', { name: `Dejar de seguir a ${a.username}` })).toBeVisible();
  await expect(main.getByRole('button', { name: /1\s*seguidor/ })).toBeVisible();
  await pb.goto('/inicio');
  await expect(pb.getByText('Primera luz de la mañana')).toBeVisible();
  await ctxB.close();

  // A elimina su publicación (con confirmación); desaparece
  await page.goto(postUrl);
  await page.getByRole('button', { name: 'Más acciones' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
  await expect(page.getByRole('heading', { name: 'Tu galería está en blanco' })).toBeVisible();
  await page.goto(postUrl);
  await expect(page.getByRole('heading', { name: 'Esta fotografía no existe' })).toBeVisible();
});

test('perfil: edición propia con avatar, y usuario inexistente', async ({ page }) => {
  const u = uniqueUser('sop');
  emails.push(u.email);
  expect((await page.request.post(`${ORIGIN}/api/auth/register`, { headers: { Origin: ORIGIN }, data: reg(u) })).status()).toBe(201);
  await page.goto(`/u/${u.username}`);
  await page.getByRole('button', { name: 'Editar perfil' }).click();
  const d = page.getByRole('dialog', { name: 'Editar perfil' });
  await d.getByLabel('Seleccionar foto de perfil').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await jpegBuffer(600, 600, '#c4b5fd') });
  await expect(page.getByText('Foto de perfil actualizada')).toBeVisible();
  await d.getByLabel('Biografía').fill('Mirada propia');
  await d.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Mirada propia')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Mirada propia')).toBeVisible();
  await expect(page.locator('main img[src*="/api/media/avatar/"]').first()).toBeVisible();
  await page.goto('/u/no_existe_usuario_xyz');
  await expect(page.getByRole('heading', { name: 'Esta fotografía no existe' })).toBeVisible();
});

test('navegación móvil: barra inferior, modal de publicar y sin desbordamiento', async ({ page }) => {
  const u = uniqueUser('som');
  emails.push(u.email);
  await page.setViewportSize({ width: 375, height: 800 });
  expect((await page.request.post(`${ORIGIN}/api/auth/register`, { headers: { Origin: ORIGIN }, data: reg(u) })).status()).toBe(201);
  await page.goto('/inicio');
  const nav = page.getByRole('navigation', { name: 'Navegación principal' }).last();
  await expect(nav).toBeVisible();
  await nav.getByRole('link', { name: 'Explorar' }).click();
  await expect(page).toHaveURL(/\/explorar$/);
  await nav.getByRole('link', { name: 'Perfil' }).click();
  await expect(page).toHaveURL(new RegExp(`/u/${u.username}$`));
  await nav.getByRole('button', { name: 'Nueva publicación' }).click();
  await expect(page.getByRole('dialog', { name: 'Nueva publicación' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});
