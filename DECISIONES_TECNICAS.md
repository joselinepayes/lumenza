# Decisiones técnicas

| # | Decisión | Motivo |
|---|---|---|
| 1 | Monorepo npm workspaces (`apps/web`, `apps/api`) | Un solo repo, scripts unificados, sin tooling extra |
| 2 | TypeScript 5.9 (no 7.x) | Versión estable y ampliamente compatible con herramientas |
| 3 | Tailwind 4 con tokens CSS (`tokens.css`) | Tema claro/oscuro por `data-theme`; un único origen de color |
| 4 | Fraunces (titulares) + Inter (UI) | Identidad editorial con excelente legibilidad |
| 5 | PostgreSQL con migraciones SQL propias | Control explícito de restricciones/índices; sin ORM |
| 6 | Sesiones opacas en BD, token hasheado, cookie HttpOnly | Revocables y listables (Ajustes); sin JWT |
| 7 | Argon2id para contraseñas | Sal individual embebida, resistente a GPU |
| 8 | `pg-boss` como cola (Fase 4–5) | Reutiliza PostgreSQL; reintentos y backoff nativos |
| 9 | `StorageService` con drivers `s3` / `local`; MinIO en local | Requisito S3 literal; sin cambiar lógica de negocio |
| 10 | Azure Blob no sustituye S3 sin autorización docente | Requisito académico |
| 11 | Las imágenes nunca van en la BD | Solo `bucket` + `storage_key` + metadatos |
| 13 | Despliegue: AKS principal, compatibilidad AWS EC2; nada facturable sin autorización | Decisión del usuario 2026-11-10 |
| 14 | vitest 4.1.12 | Corrige aviso de seguridad de `@vitest/mocker`; `npm audit` = 0 |
| 15 | RustFS 1.0.5 (digest fijo) para S3 local; sustituye a MinIO | Imágenes oficiales de MinIO no descargables (verificado). Decisión del usuario |
| 16 | Una sola implementación `S3Storage` (SDK AWS v3); proveedor por `S3_ENDPOINT` | Sin lógica duplicada por proveedor; producción = Amazon S3 |
| 17 | Puertos RustFS 9100/9101 solo en 127.0.0.1 | Evitar conflicto con otros proyectos y no exponer la consola |
| 18 | Git Bash en Windows: usar `MSYS_NO_PATHCONV=1` con rutas `/data` en docker | Si no, la ruta se convierte a `C:/Program Files/Git/data` |
| 19 | CSRF por verificación de `Origin` + cookie SameSite=Lax | SPA con API en mismo sitio; sin estado extra de token |
| 20 | Hash ficticio Argon2 si el usuario no existe | Igualar temporización y evitar enumeración de cuentas |
| 21 | reCAPTCHA/Google nunca simulados: sin claves se reporta `null`/501 | Regla del proyecto: no inventar integraciones |
| 22 | Tokens de correo: 256 bits, solo SHA-256 en BD, uso único atómico, emitir uno invalida el anterior | Una filtración de BD no permite usar enlaces |
| 23 | Verificar/restablecer por POST desde el SPA (no GET) | Escáneres de enlaces del correo no consumen el token |
| 24 | Restablecer contraseña revoca todas las sesiones y verifica el correo | El enlace prueba control del correo |
| 25 | Mailpit v1.33.1 (digest) para dev; `Mailer` sobre nodemailer | Correos reales sin salir a Internet; SMTP real en producción por `SMTP_URL` |
| 26 | Google: Code+PKCE+state+nonce con `google-auth-library`; cookie firmada | Librería mantenida; mitigación CSRF/inyección de código |
| 27 | Vincular Google a cuenta local sin verificar anula su contraseña | Evita toma de cuenta por pre-registro |
| 28 | Producción no arranca sin reCAPTCHA/SMTP/SESSION_SECRET reales | No desactivar controles en silencio |
| 29 | Playwright con `channel: msedge`, API/web de prueba en 4100/5174 con NODE_ENV=test | Sin descargar navegadores; no agota rate limits del entorno de desarrollo |
| 30 | Proveedor Google inyectable (`AuthDeps`) | Probar la lógica de vinculación sin credenciales; declarado como simulación |
| 31 | Imágenes servidas por la API (`/api/media/...`) con control de visibilidad, no URLs públicas de S3 | Bucket privado; el acceso respeta privacidad/seguidores; caché `private` |
| 32 | Validación de imágenes por contenido con sharp (JPEG/PNG/WebP), límite de píxeles, re-codificación sin EXIF | Evita polyglots y fuga de GPS; no se confía en extensión/Content-Type |
| 33 | Feed por cursor keyset `(created_at, id)` con timestamp en texto de PG | Sin duplicados ni saltos por precisión de microsegundos |
| 34 | Optimistic updates con parche global de caché (`patchPost`) | Un like se refleja a la vez en feed, explorar, perfil y detalle |
| 35 | Vite + dependencias nuevas: reiniciar el dev server si aparece `Outdated Optimize Dep` | Caché de optimización obsoleta tras `npm install` |
| 36 | `seed:demo` opt-in con cuentas `demo_*` y contraseña aleatoria | Ver la UI con contenido real vía API, sin datos falsos permanentes |
| 37 | Cola `pg-boss` (PostgreSQL), no BullMQ/Redis | Cero servicios nuevos; reintentos, expiración y encolado idempotente integrados; suficiente para el volumen |
| 38 | Worker = mismo código/imagen que la API (`CMD node dist/worker.js`) | Un solo artefacto; escalable por réplicas; perfil `worker` en Compose |
| 39 | Petición solo valida cabecera y encola (202); saneado y variantes en el worker | La API no se bloquea con trabajo pesado de Sharp |
| 40 | Original saneado (sin EXIF/GPS) y nunca filtrado; transformaciones desde un raster ≤2400 px | Privacidad, memoria acotada, un solo decode |
| 41 | Pipeline idempotente con claves deterministas por variante | Reintentos baratos y limpieza segura tras borrados |
| 42 | Original/descarga solo autor o con permiso; fotos pendientes ocultas a terceros | Privacidad y consistencia (sin imágenes rotas) |
| 43 | Colas separadas por entorno (`PHOTO_QUEUE`) en pruebas | Aislar tests/E2E del worker de desarrollo |
| 44 | Studio integrado en el detalle (no página aislada) con modo inmersivo vía Modal | Coherencia con el resto del producto |
| 45 | Detección con `@vladmandic/face-api` + TF.js WASM + SSD MobileNet v1 en el worker | face-api.js mantenido, sin compilación nativa (Windows/Docker), modelos incluidos |
| 46 | Se guardan solo recuadros normalizados `{x,y,w,h,score}`; sin landmarks/descriptores/recortes/atributos | Privacidad y minimización de datos |
| 47 | Fallo del detector no bloquea la publicación (`faces_status=failed`, reanalizable) | La detección es accesoria al contenido |
| 48 | Análisis de fotos antiguas sin cambiar su estado visible | Evita parpadeos a «procesando» |
| 49 | Visibilidad de los recuadros = visibilidad de la foto; preferencia mostrar/ocultar solo en el navegador | Sin datos adicionales ni nuevos permisos |
| 50 | Fixture de prueba: retrato NASA (dominio público) con LICENSE.md | Sin fotos con derechos desconocidos |
| 51 | TOTP con `otplib` 13 (SHA-1/6 dígitos/30 s, ±1 paso) y QR con `qrcode`; las pruebas usan una implementación RFC 6238 independiente | Compatibilidad con Google/Microsoft Authenticator y verificación cruzada |
| 52 | Secretos TOTP cifrados con AES-256-GCM (AAD=usuario), clave `MFA_ENCRYPTION_KEY` separada de `SESSION_SECRET`, sin valor por defecto | Compromiso de una clave no compromete la otra; MFA deshabilitado si falta |
| 53 | Recuperación: 10 códigos de 50 bits, HMAC-SHA256 con clave HKDF, un solo uso atómico | Un volcado de BD no revela códigos |
| 54 | Anti-replay con `last_used_step` actualizado de forma atómica; ventana ±1 | Un código capturado no se reutiliza |
| 55 | Desafío de login separado de la sesión (cookie `lz_mfa` HttpOnly, 10 min, 5 intentos); bloqueo 10 fallos/15 min por usuario vía `audit_log` | Sin sesión hasta el segundo factor; fuerza bruta acotada |
| 56 | La decisión «¿exige MFA?» consulta siempre la BD (`mfaService.gate`) y la comparten login local y Google | Un test detectó que un campo opcional dejaba saltarse MFA con Google |
| 57 | Administradores: sesión de alcance `mfa_setup` hasta enrolar; no pueden desactivar MFA | MFA obligatorio sin bloquear el propio enrolamiento |
| 58 | Operaciones sensibles con reautenticación (contraseña o sesión ≤10 min) + factor | Robo de sesión no basta para desactivar MFA |
| 12 | Rostros: solo bounding boxes, sin descriptores | Privacidad; sin identificación biométrica |
| 59 | Un único Compose para AWS (`deploy/aws`), proyecto `lumenza-aws`, independiente del de desarrollo | No rompe el entorno local ni comparte volúmenes |
| 60 | Sin Redis ni Mailpit/RustFS en AWS; cola en PostgreSQL; S3 real por rol IAM (sin claves) | Menos servicios y memoria; superficie mínima |
| 61 | PostgreSQL en red Docker `internal` y sin puertos; solo Nginx publica 80/443 | No exposición de datos |
| 62 | Nginx dentro de la imagen web (SPA + proxy `/api`), plantillas HTTP/HTTPS por `TLS_MODE`, certbot solo con `--profile tls` | HTTPS opcional hasta tener dominio; se niega a arrancar sin certificado |
| 63 | CSP estricta (`script-src 'self'` + reCAPTCHA) → script del tema externalizado | Sin `unsafe-inline` en scripts |
| 64 | `COOKIE_SECURE` y `ALLOW_MISSING_INTEGRATIONS` explícitos; por defecto seguros y con advertencia ruidosa si se relajan | Permite una etapa de despliegue previa a HTTPS/credenciales sin desactivar controles en silencio |
| 65 | Memoria: worker 768 MiB (+swap a 1 GiB), `WORKER_CONCURRENCY=1`, swap 2 GiB en el host, imágenes compiladas fuera de la EC2 | Viabilidad medida en 2 GiB |
| 66 | Restauración = recrear BD y restaurar sobre vacío (sin `--clean`), con respaldo previo y vuelta atrás | `--clean` falla con tablas particionadas de pg-boss |
| 67 | Un único script de operación `lumenza.sh` (preflight, up, health, s3-check, backup, restore, tls…) | Procedimiento reproducible sin improvisar |
| 68 | `.gitattributes` con LF y `dos2unix` en la imagen Nginx | CRLF de Windows rompe scripts en Linux |
