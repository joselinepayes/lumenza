# Plan: MFA TOTP, passkeys y cuenta del evaluador (incrementos posteriores a la Fase 5)

> Estado: **planificado, NO implementado**. Se basa en estándares (RFC 6238 TOTP, W3C WebAuthn, OWASP ASVS/Authentication Cheat Sheet). No se tiene acceso al código de SIGOAST; si se desea reutilizar sus decisiones concretas, hay que aportarlas.

Orden propuesto (cada incremento con migración, API, UI, pruebas de integración y E2E, y cierre en `PROGRESO.md`):

## Incremento A — MFA TOTP (prioridad alta)
**Datos** (migración 006): `user_mfa(user_id PK, secret_enc bytea, enabled_at, last_used_step bigint)`, `mfa_recovery_codes(id, user_id, code_hash, used_at)`, `mfa_challenges(id, user_id, token_hash, expires_at, attempts, method)`.
**Secreto**: 160 bits aleatorios (CSPRNG), cifrado en reposo con AES-256-GCM y clave `MFA_ENCRYPTION_KEY` (env; nunca en el repo). `otpauth://` + QR generado en servidor (`qrcode`) — compatible con Google/Microsoft Authenticator (SHA-1, 6 dígitos, 30 s, ventana ±1). TOTP con librería mantenida (`otplib`), comparación en tiempo constante.
**Activación**: `POST /auth/mfa/setup` (requiere sesión + contraseña reciente) devuelve QR + secreto en texto una sola vez; `POST /auth/mfa/enable {code}` confirma con un código válido y entrega **10 códigos de recuperación** (se muestran una vez; se guardan hasheados con Argon2id; un solo uso).
**Login**: contraseña correcta + MFA activo → **no se crea sesión**; se devuelve `mfa_required` + desafío opaco (10 min, hash en BD). `POST /auth/mfa/verify {challenge, code | recoveryCode}` crea la sesión. Anti-replay: se rechaza un paso de tiempo ya usado (`last_used_step`).
**Fuerza bruta**: máx. 5 intentos por desafío y 10 por usuario/15 min (bloqueo temporal + `audit_log`), rate limit por IP; mensajes genéricos.
**Google OAuth**: el callback **nunca** crea sesión si el usuario tiene MFA: genera el mismo desafío y redirige a `/login/mfa`. Vincular Google no desactiva MFA.
**Administradores**: rol `admin` con MFA obligatorio: sin MFA solo se concede una sesión de alcance `mfa_setup` (solo puede enrolarse). No existe hoy interfaz de administración; el rol queda protegido de antemano.
**Revocar/regenerar**: desactivar MFA y regenerar códigos exigen contraseña + TOTP (step-up); al regenerar se invalidan los códigos anteriores; al desactivar/cambiar se revocan las demás sesiones.
**UI**: Ajustes → Seguridad (tarjeta editorial con QR, pasos, códigos descargables), pantalla `/login/mfa` con entrada de 6 dígitos (autocompletado `one-time-code`), recuperación, estados de error/bloqueo; claro/oscuro/responsive.
**Pruebas**: TOTP válido/expirado/reutilizado, deriva ±1 paso, recuperación de un solo uso, bloqueo por intentos, Google+MFA (con proveedor inyectado), admin sin MFA, step-up, E2E con generación de TOTP real en la prueba.

## Incremento B — Passkeys (WebAuthn), opcional
**Evaluación**: viable con `@simplewebauthn/server` + `@simplewebauthn/browser` (mantenidas). Compatible con Windows Hello, Touch ID/Face ID, Android y llaves FIDO2; la biometría **nunca sale del dispositivo** (LUMENZA solo recibe una firma de clave pública): no se desarrolla reconocimiento facial propio ni se guardan plantillas.
**Requisitos**: contexto seguro (HTTPS o `localhost`); `rpID` = dominio (en AKS/AWS necesita el dominio real; cambiar de dominio invalida las credenciales).
**Diseño**: tabla `webauthn_credentials(id, user_id, credential_id, public_key, counter, transports, device_name, created_at, last_used_at)`; registro (`/auth/passkeys/register/{options,verify}`) desde Ajustes con sesión activa; inicio de sesión con credenciales descubribles (`/auth/passkeys/login/{options,verify}`), `userVerification: preferred`; una passkey con verificación de usuario cuenta como segundo factor (no se pide TOTP adicional).
**Recuperación**: otra passkey registrada, códigos de recuperación y restablecimiento por correo (que revoca passkeys solo si el usuario lo elige); al menos un método alternativo siempre disponible antes de poder eliminar la última passkey.
**Pruebas**: protocolo con autenticador virtual de Chromium (CDP WebAuthn) en E2E; integración con respuestas generadas por la librería de pruebas.

## Incremento C — Cuenta del evaluador
- Usuario normal con insignia `evaluator` (sin rol admin, sin acceso a herramientas administrativas) que solo ve contenido público y el suyo; **sin acceso a datos privados de terceros** (mismas reglas de visibilidad que cualquier usuario, verificadas por pruebas).
- Restricciones seguras: no puede cambiar correo/contraseña ni eliminar la cuenta, cuota de publicaciones y rate limits propios.
- **Contraseña jamás en el repositorio**: `npm run evaluator:setup` la genera aleatoria y la imprime una sola vez (o la toma de `EVALUATOR_PASSWORD` en el entorno); se guarda solo su hash.
- Datos controlados: reutiliza el sembrado `demo_*` (imágenes generadas, sin personas reales) + `npm run evaluator:reset` (borra y restaura el entorno del evaluador, incluidos objetos de almacenamiento) y `evaluator:revoke` (desactiva la cuenta).
- Pruebas: aislamiento (no ve privadas ni otros usuarios no demo), limitaciones, reset idempotente, no hay secretos en el repo.

## Pendientes obligatorios previos a la entrega (sin cambios)
Google OAuth real, reCAPTCHA real y SMTP de producción: **no se declaran completos hasta probarlos con credenciales reales**. Además: revisión visual de pantallas restantes, optimización del bundle, funciones secundarias de perfiles/publicaciones, Dockerfile del frontend, manifiestos AKS/AWS (sin crear recursos facturables).
