import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, cleanup, uniqueUser } from './helpers';

// Retrato NASA de dominio público (apps/api/test-fixtures/LICENSE.md). La detección es real (face-api/WASM en el worker).
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../api/test-fixtures/astronaut.png');
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
const publish = async (page: Page, buffer: Buffer, mimeType: string, fields: Record<string, string> = {}) => {
  const r = await page.request.post(`${ORIGIN}/api/posts`, { headers: { Origin: ORIGIN }, multipart: { photo: { name: 'f', mimeType, buffer }, visibility: 'public', caption: 'Rostros', ...fields } });
  expect(r.status()).toBe(202);
  return (await r.json()).post.id as string;
};
const twoFaces = async () => {
  const sharp = (await import('sharp')).default;
  const astro = await fs.readFile(FIXTURE);
  const a = await sharp(astro).resize(560).toBuffer();
  const b = await sharp(astro).resize(420).toBuffer();
  return sharp({ create: { width: 1300, height: 640, channels: 3, background: '#3a3350' } }).composite([{ input: a, left: 40, top: 40 }, { input: b, left: 760, top: 110 }]).jpeg({ quality: 92 }).toBuffer();
};
const readyStudio = (page: Page) => expect(page.getByRole('radiogroup', { name: 'Versiones de la fotografía' })).toBeVisible({ timeout: 60_000 });

test('muestra el número de rostros, dibuja recuadros precisos y permite activarlos/desactivarlos (preferencia persistente)', async ({ page }) => {
  await register(page, 'fa1');
  const id = await publish(page, await twoFaces(), 'image/jpeg');
  await page.goto(`/p/${id}`);
  await readyStudio(page);
  await expect(page.getByTestId('face-summary')).toContainText('2 rostros detectados', { timeout: 30_000 });
  await expect(page.getByTestId('face-summary')).toContainText('no identifica personas');

  const boxes = page.getByTestId('face-box');
  await expect(boxes).toHaveCount(2);
  // Los recuadros caen dentro del escenario y cada uno sobre un rostro (el rostro de la foto está en la mitad superior de cada retrato)
  const stage = (await page.getByTestId('face-overlay').boundingBox())!;
  for (let i = 0; i < 2; i++) {
    const b = (await boxes.nth(i).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(stage.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(b.y).toBeGreaterThanOrEqual(stage.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect(b.width / stage.width).toBeGreaterThan(0.03);
  }
  const b0 = (await boxes.nth(0).boundingBox())!;
  const b1 = (await boxes.nth(1).boundingBox())!;
  expect(b0.x).toBeLessThan(b1.x); // numerados de izquierda a derecha
  await expect(boxes.nth(0)).toContainText('1');
  await expect(boxes.nth(1)).toContainText('2');

  // Activar / desactivar
  const toggle = page.getByRole('button', { name: /^Rostros/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(boxes).toHaveCount(0);
  await page.reload();
  await readyStudio(page);
  await expect(page.getByRole('button', { name: /^Rostros/ })).toHaveAttribute('aria-pressed', 'false'); // la preferencia persiste
  await expect(page.getByTestId('face-box')).toHaveCount(0);
  await page.getByRole('button', { name: /^Rostros/ }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(2);

  // Integrados con las versiones y con el comparador
  await page.getByRole('radio', { name: /^Sepia/ }).click();
  await expect(page.getByTestId('face-box')).toHaveCount(2);
  await page.getByRole('button', { name: 'Comparar' }).click();
  await expect(page.getByRole('slider')).toBeVisible();
  await expect(page.getByTestId('face-box')).toHaveCount(2);

  // Pantalla completa conserva los recuadros
  await page.getByRole('button', { name: 'Abrir en pantalla completa' }).click();
  await expect(page.getByRole('dialog', { name: 'LUMENZA Studio' }).getByTestId('face-box')).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('sin rostros: contador en 0, botón deshabilitado y sin recuadros', async ({ page }) => {
  await register(page, 'fa2');
  const sharp = (await import('sharp')).default;
  const land = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2f6f8f' } }).jpeg().toBuffer();
  const id = await publish(page, land, 'image/jpeg');
  await page.goto(`/p/${id}`);
  await readyStudio(page);
  await expect(page.getByTestId('face-summary')).toContainText('No se detectaron rostros', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Rostros/ })).toBeDisabled();
  await expect(page.getByTestId('face-box')).toHaveCount(0);
});

test('privacidad: otro usuario no accede a los rostros de una fotografía privada; el aviso de privacidad se muestra al publicar', async ({ page, browser }) => {
  await register(page, 'fa3');
  const id = await publish(page, await fs.readFile(FIXTURE), 'image/png', { visibility: 'private' });
  await page.goto(`/p/${id}`);
  await readyStudio(page);
  await expect(page.getByTestId('face-summary')).toContainText('1 rostro detectado', { timeout: 30_000 });
  const other = await browser.newContext();
  const op = await other.newPage();
  await register(op, 'fa4');
  expect((await other.request.get(`${ORIGIN}/api/posts/${id}`)).status()).toBe(404);
  await other.close();

  await page.goto('/inicio');
  await page.getByRole('button', { name: 'Nueva publicación' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nueva publicación' });
  await dlg.locator('input[type=file]').setInputFiles({ name: 'f.png', mimeType: 'image/png', buffer: await fs.readFile(FIXTURE) });
  await expect(dlg.getByText(/no identifica a nadie.*no usa tu cámara/i)).toBeVisible();
});

for (const w of [320, 375, 768, 1024, 1440]) {
  test(`responsive ${w}px: recuadros alineados y sin desbordamiento (oscuro y claro)`, async ({ page }) => {
    await register(page, `fr${w}`);
    const id = await publish(page, await twoFaces(), 'image/jpeg');
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/p/${id}`);
    await readyStudio(page);
    await expect(page.getByTestId('face-box')).toHaveCount(2, { timeout: 30_000 });
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate((s) => { localStorage.setItem('lumenza-theme', s); document.documentElement.dataset.theme = s; }, scheme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${scheme}@${w}`).toBeLessThanOrEqual(0);
      const stage = (await page.getByTestId('face-overlay').boundingBox())!;
      for (let i = 0; i < 2; i++) {
        const b = (await page.getByTestId('face-box').nth(i).boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(stage.x - 1);
        expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
      }
      // el resumen y el botón siguen siendo visibles
      await expect(page.getByTestId('face-summary')).toBeVisible();
      await expect(page.getByRole('button', { name: /^Rostros/ })).toBeVisible();
    }
  });
}
