import { expect, test, type Page } from '@playwright/test';
import { ORIGIN, cleanup, jpegBuffer, uniqueUser } from './helpers';

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

/** Publica por la API (misma ruta que la UI) y devuelve el id; el worker real la procesa. */
const publishApi = async (page: Page, img: Buffer, fields: Record<string, string> = {}) => {
  const r = await page.request.post(`${ORIGIN}/api/posts`, { headers: { Origin: ORIGIN }, multipart: { photo: { name: 'f.jpg', mimeType: 'image/jpeg', buffer: img }, caption: 'Prueba de Studio', visibility: 'public', ...fields } });
  expect(r.status()).toBe(202);
  return (await r.json()).post.id as string;
};

const scene = async (w = 1600, h = 1000) => {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#27408b"/><stop offset=".6" stop-color="#e0805a"/><stop offset="1" stop-color="#f6d28b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#s)"/><circle cx="${w * 0.7}" cy="${h * 0.45}" r="${h * 0.12}" fill="#fff3c4"/><rect y="${h * 0.62}" width="100%" height="${h * 0.38}" fill="#2f6f8f"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
};

const ready = (page: Page) => expect(page.getByRole('radiogroup', { name: 'Versiones de la fotografía' })).toBeVisible({ timeout: 60_000 });

test('Studio: selector de versiones reales, comparador (teclado, ratón), pantalla completa y descarga', async ({ page }) => {
  await register(page, 'st1');
  const id = await publishApi(page, await scene(), { allowDownload: 'true' });
  await page.goto(`/p/${id}`);
  await ready(page);

  // Las cuatro versiones existen y cada una carga una imagen distinta del almacenamiento
  const radios = page.getByRole('radio');
  await expect(radios).toHaveCount(4);
  const srcs: Record<string, string> = {};
  for (const [name, kind] of [['Original', 'display'], ['Blanco y negro', 'bw_editorial'], ['Sepia', 'sepia_cinema'], ['Tono LUMENZA', 'lumen_tone']] as const) {
    await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole('radio', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-checked', 'true');
    const img = page.locator(`#studio img[src$="/${kind}"][aria-hidden="false"]`);
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    srcs[kind] = (await img.getAttribute('src'))!;
  }
  expect(new Set(Object.values(srcs)).size).toBe(4);
  await expect(page.getByText('lumen-tone@1')).toBeVisible(); // la ficha técnica muestra la receta real guardada en PostgreSQL de la versión elegida (Tono LUMENZA)

  // Comparador: deshabilitado en el original, habilitado con una transformación
  await page.getByRole('radio', { name: /^Original/ }).click();
  await expect(page.getByRole('button', { name: 'Comparar' })).toBeDisabled();
  await page.getByRole('radio', { name: /^Sepia/ }).click();
  const cmp = page.getByRole('button', { name: 'Comparar' });
  await cmp.click();
  await expect(cmp).toHaveAttribute('aria-pressed', 'true');
  const slider = page.getByRole('slider', { name: 'Comparador antes y después' });
  await expect(slider).toHaveAttribute('aria-valuenow', '50');

  // Teclado
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '52');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuenow', '42');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');

  // Ratón: arrastre real sobre el escenario
  const box = (await slider.locator('xpath=..').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const v = Number(await slider.getAttribute('aria-valuenow'));
  expect(v).toBeGreaterThan(18);
  expect(v).toBeLessThan(32);

  // Pantalla completa (Studio inmersivo) y cierre con Escape
  await page.getByRole('button', { name: 'Abrir en pantalla completa' }).click();
  const dlg = page.getByRole('dialog', { name: 'LUMENZA Studio' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('radiogroup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);

  // Descarga autorizada de la transformación elegida
  const link = page.getByRole('link', { name: /Descargar sepia/i });
  await expect(link).toHaveAttribute('href', new RegExp(`/api/media/photo/.+/sepia_cinema\\?download=1`));
  const resp = await page.request.get((await link.getAttribute('href'))!);
  expect(resp.status()).toBe(200);
  expect(resp.headers()['content-disposition']).toContain('attachment');
});

test('Studio: el comparador responde a gestos táctiles (CDP touch)', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  await register(page, 'st2');
  const id = await publishApi(page, await scene());
  await page.goto(`/p/${id}`);
  await ready(page);
  await page.getByRole('radio', { name: /^Tono LUMENZA/ }).click();
  await page.getByRole('button', { name: 'Comparar' }).click();
  const slider = page.getByRole('slider', { name: 'Comparador antes y después' });
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  const box = (await slider.locator('xpath=..').boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const y = box.y + box.height / 2;
  const x = (f: number) => box.x + box.width * f;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x(0.5), y }] });
  for (const f of [0.6, 0.7, 0.8, 0.85]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x(f), y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const v = Number(await slider.getAttribute('aria-valuenow'));
  expect(v).toBeGreaterThan(75);
  await ctx.close();
});

test('integración: feed muestra el estado y el acceso a Studio; el detalle muestra el progreso real y el fallo con reintento', async ({ page }) => {
  const u = await register(page, 'st3');
  // Imagen válida → feed
  const id = await publishApi(page, await scene(), { caption: 'Para el feed' });
  await page.goto('/inicio');
  const card = page.getByRole('article', { name: `Publicación de ${u.username}` });
  await expect(card.getByRole('link', { name: /LUMENZA Studio: 3 versiones/ })).toBeVisible({ timeout: 60_000 }); // sin recargar: la tarjeta se actualiza sola
  await card.getByRole('link', { name: /LUMENZA Studio: 3 versiones/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${id}#studio`));
  await ready(page);

  // Imagen corrupta (cabecera válida, datos truncados) → «failed» visible con reintento para el autor
  const sharp = (await import('sharp')).default;
  void sharp;
  const good = await scene(900, 600);
  const bad = await publishApi(page, good.subarray(0, Math.floor(good.length * 0.5)), { caption: 'Corrupta' });
  await page.goto(`/p/${bad}`);
  await expect(page.getByRole('heading', { name: 'No pudimos procesar la imagen' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Reintentar procesamiento' })).toBeVisible();

  // Eliminar la publicación procesada limpia todo
  await page.goto(`/p/${id}`);
  await page.getByRole('button', { name: 'Más acciones' }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page).toHaveURL(/\/inicio$/);
});

test('privacidad: otro usuario no accede a las versiones de una fotografía privada', async ({ page, browser }) => {
  await register(page, 'st4');
  const id = await publishApi(page, await scene(), { visibility: 'private', caption: 'Privada' });
  await page.goto(`/p/${id}`);
  await ready(page);
  const photoId = (await (await page.request.get(`${ORIGIN}/api/posts/${id}`)).json()).post.photo.id as string;
  const other = await browser.newContext();
  const op = await other.newPage();
  await register(op, 'st5');
  for (const k of ['display', 'thumbnail', 'bw_editorial', 'sepia_cinema', 'lumen_tone', 'original']) expect((await other.request.get(`${ORIGIN}/api/media/photo/${photoId}/${k}`)).status(), k).toBe(404);
  await op.goto(`/p/${id}`);
  await expect(op.getByRole('heading', { name: 'Esta fotografía no existe' })).toBeVisible();
  await other.close();
});

for (const w of [320, 375, 768, 1024, 1440]) {
  test(`responsive ${w}px: Studio sin desbordamiento, en modo oscuro y claro`, async ({ page }) => {
    await register(page, `rs${w}`);
    const id = await publishApi(page, await scene());
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/p/${id}`);
    await ready(page);
    const bgs: string[] = [];
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'no-preference' });
      await page.evaluate((s) => { localStorage.setItem('lumenza-theme', s); document.documentElement.dataset.theme = s; }, scheme);
      await page.getByRole('radio', { name: /^Sepia/ }).click();
      await page.getByRole('button', { name: 'Comparar' }).click();
      await expect(page.getByRole('slider')).toBeVisible();
      await page.waitForTimeout(900); // termina el barrido de entrada del comparador
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${scheme}@${w}`).toBeLessThanOrEqual(0);
      // sin elementos fuera del viewport (excepto contenedores con scroll propio)
      const off = await page.evaluate(() => [...document.querySelectorAll('#studio *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length);
      expect(off, `fuera del viewport ${scheme}@${w}`).toBe(0);
      bgs.push(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor));
      await page.getByRole('button', { name: 'Comparar' }).click(); // desactiva
    }
    expect(bgs[0]).not.toBe(bgs[1]); // los temas son realmente distintos
  });
}

test('accesibilidad: prefers-reduced-motion anula las transiciones del comparador', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await register(page, 'st6');
  const id = await publishApi(page, await scene());
  await page.goto(`/p/${id}`);
  await ready(page);
  await page.getByRole('radio', { name: /^Blanco y negro/ }).click();
  await page.getByRole('button', { name: 'Comparar' }).click();
  const dur = await page.getByRole('slider').evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(dur)).toBeLessThan(0.001);
});
