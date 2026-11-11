# Configuración de integraciones externas (Fase 2)

> Estado: **código listo, NO verificado con servicios reales** para Google OAuth y reCAPTCHA (faltan credenciales). El correo sí está verificado con Mailpit local.

## 1. Google OAuth 2.0 (Authorization Code + PKCE)
Implementación: `apps/api/src/modules/auth/google.ts` (librería mantenida `google-auth-library`), `google.service.ts` (vinculación) y rutas `GET /api/auth/google` y `GET /api/auth/google/callback`.

Seguridad implementada: `state` aleatorio + PKCE (S256) + `nonce` guardados en cookie **firmada, HttpOnly, SameSite=Lax, 10 min**, limitada a la ruta de Google; validación de firma/audiencia/expiración del `id_token`; solo se usan cuentas con `email_verified=true`.

Vinculación: por `google_sub`; si existe una cuenta local con ese correo → se vincula. Si esa cuenta local tenía el correo **sin verificar**, se **anula su contraseña y se revocan sus sesiones** (evita toma de cuenta por pre-registro).

### Pasos
1. Google Cloud Console → *APIs y servicios* → *Pantalla de consentimiento OAuth* (externo; scopes `openid`, `email`, `profile`).
2. *Credenciales* → *ID de cliente OAuth* → tipo **Aplicación web**.
3. URI de redirección autorizada: `http://localhost:4000/api/auth/google/callback` (en producción, tu dominio HTTPS).
4. Copia a `.env` (nunca al repositorio): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
5. Reinicia la API. `GET /api/auth/config` devolverá `"google": true` y el botón aparecerá en login/registro.

Sin credenciales: el botón no se muestra y `/api/auth/google` redirige a `/login?error=google_not_configured`.

## 2. reCAPTCHA v2 (casilla)
Implementación: `recaptcha.ts` (verificación en servidor contra `https://www.google.com/recaptcha/api/siteverify`) y `Recaptcha.tsx`. Se exige en registro, login y recuperación.

### Pasos
1. https://www.google.com/recaptcha/admin → crear sitio **reCAPTCHA v2 "No soy un robot"**, dominios `localhost` (y el de producción).
2. `.env`: `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`. Reinicia la API.

Errores: `captcha_required`, `captcha_failed` (400), `captcha_unavailable` (503, no se omite la verificación).
Sin claves en desarrollo se reporta `recaptcha: null` y no se exige. **En producción** (`NODE_ENV=production`) la API no arranca si faltan estas claves, `SMTP_URL` o un `SESSION_SECRET` aleatorio.

## 3. Correo
- Desarrollo: **Mailpit** (`docker compose up -d mailpit`), SMTP `127.0.0.1:1025`, bandeja web `http://localhost:8025`. Solo escucha en localhost; no entrega a Internet.
- Producción: `SMTP_URL=smtps://usuario:clave@host:465` y `MAIL_FROM` con un remitente de dominio verificado (SPF/DKIM). Abstracción: `apps/api/src/mail/mailer.ts`.
