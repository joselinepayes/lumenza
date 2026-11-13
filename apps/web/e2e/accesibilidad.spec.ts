// Paso 10A: E1 (listas de perfiles privados), E2 (nombre accesible del botón de seguir) y E3 (títulos de página).
// Usuarios ficticios; con SHOTS_DIR definido guarda capturas fuera del repositorio.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { ORIGIN, cleanup, jpegBuffer, uniqueUser } from './helpers';

const A = uniqueUser('aca'), B = uniqueUser('acb'), C = uniqueUser('acc'), E = uniqueUser('ace');
const A_NAME = 'Cuenta Reservada Auditable';
const emails = [A.email, B.email, C.email, E.email];
const reg = (u: ReturnType<typeof uniqueUser>, name = u.name) => ({ displayName: name, username: u.username, email: u.email, password: u.password, confirmPassword: u.password });
const hdr = { Origin: ORIGIN };
const shot = async (page: Page, name: string) => { if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true }); };
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let ctxA: BrowserContext, ctxB: BrowserContext, ctxC: BrowserContext, ctxE: BrowserContext;
let pageA: Page, pageB: Page, pageC: Page;
let postId = '';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

test.beforeAll(async ({ browser }) => {
  const mk = () => browser.newContext({ baseURL: ORIGIN });
  [ctxA, ctxB, ctxC, ctxE] = await Promise.all([mk(), mk(), mk(), mk()]);
  for (const [ctx, u, name] of [[ctxA, A, A_NAME], [ctxB, B, undefined], [ctxC, C, undefined], [ctxE, E, undefined]] as const) {
    expect((await ctx.request.post(`${ORIGIN}/api/auth/register`, { headers: hdr, data: reg(u, name) })).status(), `registro ${u.username}`).toBe(201);
  }
  expect((await ctxA.request.patch(`${ORIGIN}/api/me/settings`, { headers: hdr, data: { isPrivate: true } })).status()).toBe(200);
  [pageA, pageB, pageC] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxC.newPage()]);
});
test.afterAll(async () => {
  // allSettled: si cerrar un contexto falla (p. ej. archivos de traza bloqueados por la sincronización de OneDrive), la limpieza igual se ejecuta
  await Promise.allSettled([ctxA, ctxB, ctxC, ctxE].map((c) => c?.close()));
  for (const e of emails) await cleanup(e);
});

/** Botón de seguir del perfil abierto: su nombre accesible siempre termina en el nombre de usuario. */
const followBtn = (page: Page, username: string): Locator => page.getByRole('main').getByRole('button', { name: new RegExp(`${username}$`) });

/** WCAG 2.5.3: el nombre accesible debe contener el texto visible; además, sin aria-pressed (el estado va en el nombre). */
async function expectState(btn: Locator, visible: string, accessible: string) {
  await expect(btn).toHaveText(visible);
  await expect(btn).toHaveAccessibleName(accessible);
  await expect(btn).not.toHaveAttribute('aria-pressed', /.*/);
  const [name, text] = await btn.evaluate((e) => [e.getAttribute('aria-label') ?? '', (e as HTMLElement).innerText.trim()]);
  expect(name.toLowerCase()).toContain(text.toLowerCase());
}

test('E2: el botón de seguir tiene un nombre accesible correcto en cada estado (seguir, solicitado, cancelar, rechazada, siguiendo)', async () => {
  await pageB.setViewportSize({ width: 1366, height: 768 });
  await pageB.goto(`/u/${A.username}`);
  await expect(pageB.getByRole('heading', { name: 'Este perfil es privado' })).toBeVisible();
  const btn = followBtn(pageB, A.username);

  // Perfil privado sin relación: «Solicitar»
  await expectState(btn, 'Solicitar', `Solicitar seguir a ${A.username}`);
  // Solicitud pendiente: «Solicitado» (el nombre refleja el estado y la acción real: cancelar)
  await btn.click();
  await expectState(btn, 'Solicitado', `Solicitado: cancelar la solicitud para seguir a ${A.username}`);
  await shot(pageB, 'e2-solicitado-1366');
  // Cancelar la solicitud ya existe (pulsar «Solicitado» envía DELETE): vuelve a «Solicitar»
  await btn.click();
  await expectState(btn, 'Solicitar', `Solicitar seguir a ${A.username}`);
  // Solicitud rechazada por A: tras recargar vuelve a «Solicitar» (no hay aviso de rechazo por diseño de privacidad)
  await btn.click();
  await expectState(btn, 'Solicitado', `Solicitado: cancelar la solicitud para seguir a ${A.username}`);
  expect((await ctxA.request.post(`${ORIGIN}/api/me/follow-requests/${B.username}/decline`, { headers: hdr })).status()).toBe(200);
  await pageB.reload();
  await expectState(followBtn(pageB, A.username), 'Solicitar', `Solicitar seguir a ${A.username}`);
  // Solicitud aceptada: «Siguiendo»
  await followBtn(pageB, A.username).click();
  await expectState(followBtn(pageB, A.username), 'Solicitado', `Solicitado: cancelar la solicitud para seguir a ${A.username}`); // la solicitud ya existe en el servidor antes de aceptarla
  expect((await ctxA.request.post(`${ORIGIN}/api/me/follow-requests/${B.username}/accept`, { headers: hdr })).status()).toBe(200);
  await pageB.reload();
  await expectState(followBtn(pageB, A.username), 'Siguiendo', `Siguiendo: dejar de seguir a ${A.username}`);
  // Perfil público: «Seguir» → «Siguiendo»
  await pageB.goto(`/u/${C.username}`);
  await expectState(followBtn(pageB, C.username), 'Seguir', `Seguir a ${C.username}`);
  await followBtn(pageB, C.username).click();
  await expectState(followBtn(pageB, C.username), 'Siguiendo', `Siguiendo: dejar de seguir a ${C.username}`);
  // Panel de sugerencias (otro uso del mismo componente): ningún botón de seguir tiene un nombre que no empiece por su texto visible
  await pageB.goto('/inicio');
  await expect(pageB.getByRole('complementary', { name: 'Sugerencias' }).first()).toBeVisible();
  const mismatches = await pageB.evaluate(() => [...document.querySelectorAll('aside[aria-label=Sugerencias] button')].filter((b) => !(b.getAttribute('aria-label') ?? '').toLowerCase().includes((b as HTMLElement).innerText.trim().toLowerCase())).length);
  expect(mismatches).toBe(0);
  // Dejar B siguiendo a A para las pruebas siguientes
  await pageB.goto(`/u/${A.username}`);
  await expectState(followBtn(pageB, A.username), 'Siguiendo', `Siguiendo: dejar de seguir a ${A.username}`);
});

test('E1: las listas de un perfil privado explican la restricción a quien no está autorizado, sin revelar identidades; dueño y seguidor aceptado las ven', async () => {
  const stat = (p: Page, re: RegExp) => p.getByRole('main').getByRole('button', { name: re });

  // Dueña: contador y lista completa
  await pageA.setViewportSize({ width: 1366, height: 768 });
  await pageA.goto(`/u/${A.username}`);
  const ownerCount = await stat(pageA, /seguidor/).innerText();
  await stat(pageA, /seguidor/).click();
  const ownerDlg = pageA.getByRole('dialog', { name: 'Seguidores' });
  await expect(ownerDlg.locator(`a[href="/u/${B.username}"]`)).toBeVisible();
  await expect(ownerDlg).not.toContainText('no está disponible');
  await pageA.keyboard.press('Escape');

  // Seguidor aceptado (B): ve la lista
  await pageB.goto(`/u/${A.username}`);
  await stat(pageB, /seguidor/).click();
  const approvedDlg = pageB.getByRole('dialog', { name: 'Seguidores' });
  await expect(approvedDlg.locator(`a[href="/u/${B.username}"]`)).toBeVisible();
  await expect(approvedDlg).not.toContainText('no está disponible');
  await pageB.keyboard.press('Escape');

  // Visitante sin autorización (C), en escritorio y móvil
  for (const vp of [{ w: 1366, h: 768 }, { w: 375, h: 812 }]) {
    await pageC.setViewportSize({ width: vp.w, height: vp.h });
    await pageC.goto(`/u/${A.username}`);
    await expect(pageC.getByRole('heading', { name: 'Este perfil es privado' })).toBeVisible();
    // El contador se conserva (igual que el de la dueña)...
    await expect(stat(pageC, /seguidor/)).toHaveText(new RegExp(`^${ownerCount.replace(/\s+/g, '')}$`));
    await stat(pageC, /seguidor/).click();
    const dlg = pageC.getByRole('dialog', { name: 'Seguidores' });
    // ...pero la lista dice que no está disponible por privacidad (no «aún no tiene seguidores») y no expone a nadie
    await expect(dlg).toContainText('La lista de seguidores no está disponible porque este perfil es privado.');
    await expect(dlg).not.toContainText('Aún no tiene seguidores');
    await expect(dlg.locator('a[href^="/u/"]')).toHaveCount(0);
    expect(await dlg.innerText()).not.toContain(B.username);
    expect(await overflow(pageC)).toBeLessThanOrEqual(0);
    await shot(pageC, `e1-lista-restringida-${vp.w}`);
    await pageC.keyboard.press('Escape');
    await stat(pageC, /siguiendo/).click();
    await expect(pageC.getByRole('dialog', { name: 'Siguiendo' })).toContainText('La lista de personas que sigue no está disponible porque este perfil es privado.');
    await expect(pageC.getByRole('dialog', { name: 'Siguiendo' })).not.toContainText('Aún no sigue a nadie');
    await pageC.keyboard.press('Escape');
  }
  // Perfil público: una lista realmente vacía conserva su mensaje original
  await pageC.goto(`/u/${E.username}`);
  await stat(pageC, /seguidor/).click();
  await expect(pageC.getByRole('dialog', { name: 'Seguidores' })).toContainText('Aún no tiene seguidores.');
});

test('E3: cada ruta tiene su título; los de perfiles/publicaciones no filtran información privada; el contador de avisos se combina con el título', async () => {
  const t = (s: string) => new RegExp(`^(\\(\\d+\\+?\\) )?${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\| LUMENZA$`);
  // --- Sin sesión ---
  const anon = await ctxE.browser()!.newContext({ baseURL: ORIGIN });
  const pa = await anon.newPage();
  const anonTitles: [string, string | RegExp][] = [['/', 'LUMENZA | Cada mirada cuenta una historia'], ['/login', 'Iniciar sesión | LUMENZA'], ['/registro', 'Registro | LUMENZA'], ['/recuperar', 'Recuperar contraseña | LUMENZA'], ['/ruta-que-no-existe', 'Página no encontrada | LUMENZA']];
  for (const [path, title] of anonTitles) { await pa.goto(path); await expect(pa).toHaveTitle(title); }
  await anon.close();

  // --- Con sesión (B): rutas principales, sin haber abierto aún Avisos (B tiene avisos sin leer por las solicitudes aceptadas) ---
  await pageB.setViewportSize({ width: 1366, height: 768 });
  await pageB.goto('/inicio');
  await expect(pageB).toHaveTitle(t('Inicio'));
  await expect.poll(() => pageB.title(), { message: 'el contador de avisos sin leer aparece en el título' }).toMatch(/^\(\d+\+?\) Inicio \| LUMENZA$/);
  // Navegación del lado del cliente (sin recargar): el título cambia y conserva el contador; al volver se restaura
  await pageB.getByRole('link', { name: 'Explorar', exact: true }).first().click();
  await expect(pageB).toHaveTitle(/^\(\d+\+?\) Explorar \| LUMENZA$/);
  await pageB.goBack();
  await expect(pageB).toHaveTitle(/^\(\d+\+?\) Inicio \| LUMENZA$/);
  await pageB.goto('/ajustes/seguridad');
  await expect(pageB).toHaveTitle(t('Seguridad'));
  await pageB.goto('/ajustes/privacidad');
  await expect(pageB).toHaveTitle(t('Privacidad'));

  // --- Perfiles ---
  // Perfil privado visto por una persona NO autorizada: título genérico, sin el nombre
  await pageC.goto(`/u/${A.username}`);
  await expect(pageC).toHaveTitle(t('Perfil privado'));
  expect(await pageC.title()).not.toContain('Reservada');
  expect(await pageC.title()).not.toContain(A.username);
  // El mismo perfil visto por un seguidor aceptado o por su dueña: nombre y usuario
  await pageB.goto(`/u/${A.username}`);
  await expect(pageB).toHaveTitle(t(`${A_NAME} (@${A.username})`));
  // Perfil público y perfil inexistente
  await pageB.goto(`/u/${C.username}`);
  await expect(pageB).toHaveTitle(t(`${C.name} (@${C.username})`));
  await pageB.goto('/u/no_existe_usuario_xyz');
  await expect(pageB).toHaveTitle(t('Perfil no encontrado'));

  // --- Estado de carga: título genérico mientras llegan los datos, luego el definitivo ---
  await pageB.route(/\/api\/users\/[^/]+$/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
  await pageB.goto(`/u/${C.username}`);
  await expect(pageB).toHaveTitle(t('Perfil'));
  await expect(pageB).toHaveTitle(t(`${C.name} (@${C.username})`));
  await pageB.unroute(/\/api\/users\/[^/]+$/);

  // --- Publicaciones: sin el texto de la publicación ---
  const up = await ctxA.request.post(`${ORIGIN}/api/posts`, { headers: hdr, multipart: { caption: 'Texto privado SECRETO de la publicación', tags: 'titulo', category: 'naturaleza', visibility: 'public', allowDownload: 'false', photo: { name: 'f.jpg', mimeType: 'image/jpeg', buffer: await jpegBuffer(1000, 700, '#9673f7') } } });
  expect(up.status()).toBe(202);
  postId = (await up.json()).post.id;
  // Hasta que el worker termina, la publicación solo la ve su autora: se espera al estado real
  await expect.poll(async () => (await (await ctxA.request.get(`${ORIGIN}/api/posts/${postId}`)).json()).post?.processing?.status, { timeout: 120_000, intervals: [1000] }).toMatch(/ready|partial/);
  await pageB.goto(`/p/${postId}`);
  await expect(pageB).toHaveTitle(t(`Fotografía de ${A_NAME}`));
  expect(await pageB.title()).not.toContain('SECRETO');
  await pageC.goto(`/p/${postId}`);
  await expect(pageC).toHaveTitle(t('Publicación no disponible')); // A es privada: C no puede verla y el título no la delata
  expect(await pageC.title()).not.toContain('SECRETO');
  expect(await pageC.title()).not.toContain('Reservada');
  await pageB.goto('/p/00000000-0000-4000-8000-000000000000');
  await expect(pageB).toHaveTitle(t('Publicación no disponible'));

  // --- Avisos (al final: abrir esta página marca los avisos como leídos y retira el contador) ---
  await pageB.goto('/notificaciones');
  await expect(pageB).toHaveTitle(t('Notificaciones'));
  await expect.poll(() => pageB.title(), { timeout: 10_000, message: 'el prefijo desaparece cuando no quedan avisos sin leer' }).toBe('Notificaciones | LUMENZA');
  // Cerrar sesión restaura un título sin contador
  await pageB.goto('/inicio');
  await pageB.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await expect(pageB).toHaveURL(/\/login$/);
  await expect(pageB).toHaveTitle('Iniciar sesión | LUMENZA');
});

test('responsive: botón de seguir y lista restringida sin desbordamiento en 375 y 1366 px', async () => {
  for (const vp of [{ w: 375, h: 812 }, { w: 1366, h: 768 }]) {
    await pageC.setViewportSize({ width: vp.w, height: vp.h });
    await pageC.goto(`/u/${A.username}`);
    await expect(pageC.getByRole('heading', { name: 'Este perfil es privado' })).toBeVisible();
    expect(await overflow(pageC)).toBeLessThanOrEqual(0);
    await followBtn(pageC, A.username).click();
    await expectState(followBtn(pageC, A.username), 'Solicitado', `Solicitado: cancelar la solicitud para seguir a ${A.username}`);
    const box = await followBtn(pageC, A.username).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.w);
    expect(await overflow(pageC)).toBeLessThanOrEqual(0);
    await shot(pageC, `e2-solicitado-responsive-${vp.w}`);
    await followBtn(pageC, A.username).click(); // cancelar para dejar el estado limpio
    await expectState(followBtn(pageC, A.username), 'Solicitar', `Solicitar seguir a ${A.username}`);
  }
});
