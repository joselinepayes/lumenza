# PROGRESO — LUMENZA

## Fase 0 — Análisis ✅  (`docs/FASE_0_ANALISIS.md`)

## Fase 1 — Fundamentos ✅ (verificado 2026-11-10)
- **Docker**: `lumenza-db-1` (postgres:17-alpine) y `lumenza-rustfs-1` (`rustfs/rustfs:1.0.5` fijada por digest, volumen `lumenza_rustfsdata`, puertos 127.0.0.1:9100/9101) → ambos *healthy*. Contenedores `cloudstore-*` intactos. Sin comandos destructivos.
- **PostgreSQL**: migración `001_init.sql` aplicada e idempotente; 15 tablas de dominio, 20 FK, 11 CHECK, 37 índices; **0 columnas bytea/oid** (sin binarios).
- **Almacenamiento**: `StorageService` (`apps/api/src/storage`) con una sola implementación S3 (`@aws-sdk/client-s3`); `S3_ENDPOINT` presente → RustFS, vacío → Amazon S3. Bucket privado; URLs firmadas.
- **Pruebas de integración reales contra RustFS** (`npm run test:integration -w @lumenza/api`): 7/7 — crear bucket, subir, descargar (contenido idéntico), URL firmada OK, acceso anónimo rechazado, eliminar, objeto inexistente → `not_found`, credenciales inválidas → `StorageError`, servicio caído → `unavailable`.
- **Persistencia**: objeto subido → `docker restart lumenza-rustfs-1` → recuperado y borrado correctamente.
- **/api/ready** → `200 {"status":"ready","db":true,"storage":true}`.
- typecheck 0 errores · `npm test` 3 pasan (7 de integración se omiten sin `INTEGRATION=1`) · build ✔ · `npm audit` 0.
- **Visual**: claro y oscuro; landing sin desbordamiento en 320/375/768/1024/1440; `/design` sin elementos fuera del viewport en 375/768/1440; contrastes ≥ 4.5:1 en ambos temas (calculados); toggle de tema funciona; animación de entrada del hero termina (`finished`).
- Seguridad: `.env` en `.gitignore`; `.env.example` sin secretos; credenciales locales aleatorias solo en `.env`.

**Limitaciones conocidas Fase 1**: no se probó `prefers-reduced-motion` en navegador (solo CSS); no hay políticas de bucket/AWS Block Public Access (se documentarán en Fase 9); `/login` y `/registro` mostraban 404 hasta Fase 2.

## Fase 2 — Autenticación ✅ en código · 🟡 integraciones externas sin verificar (2026-11-10)

**2a (registro/login/sesiones)** — ver sección anterior de decisiones; 17 pruebas originales conservadas y en verde.

**2b — Implementado y verificado**
- **Verificación de correo**: token aleatorio 256 bits, solo se guarda su SHA-256, expira en 24 h, uso único (atómico), emitir uno nuevo invalida el anterior, reenvío con cooldown 60 s + rate limit 5/h, estado `email_verified` en PostgreSQL, eventos en `audit_log`. Pantalla `/verificar-correo` y aviso con "Reenviar" en `/inicio`.
- **Recuperación de contraseña**: `/recuperar` y `/restablecer`; respuesta idéntica exista o no la cuenta (verificado: sin correo para cuentas inexistentes), token 30 min de un solo uso, nueva clave Argon2id, **todas las sesiones revocadas** y token invalidado en la misma transacción. Token retirado de la URL en el frontend; `Referrer-Policy: no-referrer`.
- **Correo**: abstracción `Mailer` (nodemailer) + **Mailpit v1.33.1 fijado por digest** en Compose (solo 127.0.0.1:1025/8025). Plantillas HTML/texto de marca.
- **Google OAuth** (Authorization Code + PKCE S256 + state + nonce, cookie firmada HttpOnly, `google-auth-library`) con vinculación segura: nunca con correo no verificado de Google; si la cuenta local tenía el correo sin verificar se anula su contraseña y se revocan sus sesiones. Sustituye al antiguo 501.
- **reCAPTCHA v2**: verificación en backend con códigos `captcha_required/failed/unavailable`; exigido en registro, login y recuperación cuando hay claves. En producción la API no arranca sin claves reCAPTCHA, `SMTP_URL` ni `SESSION_SECRET` real.
- **Migración 002** aplicada (`email_tokens.created_at`, `ip`, índice).
- **Frontend**: StatusPanel editorial (diafragma animado), ForgotPassword, ResetPassword, VerifyEmail, VerifyBanner, GoogleSection (solo visible si Google está configurado).

**Pruebas ejecutadas (resultados reales)**
- typecheck 0 errores · build ✔ · `npm audit` 0.
- Unitarias: 8/8 (3 base + 5 reCAPTCHA con respuesta de Google **simulada**).
- Integración (PostgreSQL + RustFS + Mailpit reales): **40/40** = 7 storage + 10 auth (las 17 previas) + 13 flujos (verificación válida/expirada/usada/inválida, reenvío+cooldown, recuperación, anti-enumeración, revocación de sesiones, audit_log, CSRF y 401 en endpoints nuevos, **rate limiting real**) + 10 Google (**proveedor simulado**: state, cookie manipulada, cancelación, PKCE inválido, usuario nuevo, vinculación verificada/no verificada, correo no verificado).
- **E2E Playwright (Microsoft Edge, servidores de prueba 4100/5174)**: 5/5 — ruta protegida, registro→verificación con correo real de Mailpit→logout→login, error de login, enlace inválido, recuperación completa con revocación de otra sesión y reutilización de enlace.
- Visual: `/recuperar`, `/restablecer`, `/verificar-correo`, `/login` sin desbordamiento a 320 px; capturas en oscuro y claro a 375 px; aside visible en 1440 px.
- Datos de prueba eliminados; la BD quedó con 0 usuarios.

**Pendiente / NO verificado**
- **Google OAuth real**: nunca se probó contra Google (sin credenciales). Las pruebas cubren nuestra lógica con un proveedor simulado.
- **reCAPTCHA real**: no probado contra Google; widget del navegador sin probar.
- **SMTP real de producción**: solo Mailpit.
- Sin pruebas visuales automatizadas de las pantallas nuevas en 768/1024 ni captura del correo renderizado en clientes reales.
- Gestión de sesiones activas, cambio de contraseña, borrar cuenta → Fase 6. Documentación de configuración: `docs/CONFIGURACION_INTEGRACIONES.md`.

**Próximo paso exacto**: aportar credenciales Google/reCAPTCHA para verificarlas de verdad (o aceptar la Fase 2 con ese riesgo) y comenzar Fase 3: AppShell (sidebar/rail/bottom-nav) + feed.

## Fase 3 — Experiencia social ✅ funcional · 🟡 limitaciones conocidas (2026-11-10)

**Implementado (React + Express + PostgreSQL + RustFS reales)**
- **Navegación (AppShell)**: sidebar completa (≥1024), rail de iconos (768–1023), barra inferior en móvil, panel de sugerencias (≥1280). Modo claro/oscuro, accesible por teclado.
- **Feed** (`/inicio`): solo seguidos + propios, paginación por cursor keyset con carga incremental (IntersectionObserver), skeletons, estados vacío/error, doble clic para "me gusta".
- **Publicaciones**: modal de publicar (arrastrar/seleccionar, validación en cliente, descripción, etiquetas, categoría, visibilidad, permitir descarga, **progreso real de subida**, cancelación); servidor valida por **contenido** (sharp), limita 15 MB / 60 MP / mín. 200 px, rechaza SVG/GIF/falsos, re-codifica sin EXIF; guarda original + `display` (1440) + `thumbnail` (640) en S3 y solo metadatos en BD (`photos`, `photo_variants`). Detalle `/p/:id`, borrado con confirmación (elimina filas y objetos).
- **Interacciones**: like y guardar (idempotentes, optimistas), comentarios (crear/listar/borrar por autor o dueño), compartir enlace, menú contextual, descarga del original solo si el autor lo permite.
- **Perfiles** (`/u/:username`): avatar (subida procesada), nombre, bio, contadores reales, seguir/dejar de seguir, listas de seguidores/siguiendo, pestañas Publicaciones y Guardados (**solo dueño**), edición propia (no se puede editar perfiles ajenos).
- **Explorar** (`/explorar`): destacadas, masonry, categorías, búsqueda de fotos/personas/etiquetas, filtros por URL, estados sin resultados.
- **Visibilidad** pública/seguidores/privada aplicada a posts, feed, explorar y a los **archivos** (`/api/media/...`).
- Notificaciones: las filas (seguidor/like/comentario) ya se crean en BD; **la pantalla llega en la Fase 6**.
- Migración 003 aplicada (`variant_kind='display'`, índices). Datos demo opt-in: `npm run seed:demo -w @lumenza/api` (`-- clean` para borrarlos).

**Pruebas ejecutadas (resultados reales, 2026-11-10)**
- typecheck 0 errores · build ✔ · `npm audit` 0 · `/api/ready` 200 (db+storage).
- Unitarias 8/8.
- **Integración 52/52** (PostgreSQL + RustFS + Mailpit): +12 sociales (publicación y validación por contenido, 413, SVG/GIF/falsos, almacenamiento real y 0 bytea, visibilidad privada/seguidores incluidos archivos, seguir, feed con paginación sin duplicados, likes/guardados/notificaciones, comentarios y permisos de borrado, explorar/búsqueda, perfil y avatar, borrado con limpieza de objetos, 401/CSRF/404).
- **E2E Playwright (Edge) 8/8**: 5 de auth (adaptados al nuevo layout) + 3 sociales (publicar con foto real, imagen cargada `naturalWidth>0`, like/guardar/comentar, perfil, explorar por categoría/etiqueta/búsqueda, segundo navegador sigue y ve el feed, no puede editar perfil ajeno, borrar con confirmación, edición de perfil con avatar, navegación móvil + modal + sin desbordamiento).
- **Visual** (navegador integrado): feed, explorar, perfil y detalle en oscuro 1100 px; feed en claro 375 px; modal de publicar en claro. Sin desbordamiento horizontal a 320/768/1024/1440 en `/inicio`, `/explorar`, perfil y detalle (corregido un desbordamiento del perfil a 320 px). Bug corregido en destacadas (tile vacío).

**Limitaciones conocidas / pendiente**
- No verificado visualmente: detalle y perfil en modo claro de escritorio; modal de publicar con foto cargada; comportamiento táctil real.
- Falta imagen de portada del perfil, edición de publicaciones, reportes, privacidad de cuenta (Fase 6), pantalla de notificaciones (Fase 6), "ver más comentarios" es botón (no automático).
- Laboratorio creativo (3 transformaciones), detección de rostros y cola asíncrona: **Fase 4–5** (hoy solo se genera `display`+`thumbnail` de forma síncrona).
- Bundle JS > 500 kB sin dividir (optimizar en Fase 7). Sin pruebas automáticas de accesibilidad.
- **Pendientes obligatorios antes de la entrega**: validar Google OAuth y reCAPTCHA con credenciales reales; SMTP de producción.

**Próximo paso exacto**: Fase 4 completada (abajo); siguiente: Fase 5 (detección de rostros con cuadros delimitadores en el worker, sin biometría).

## Fase 4 — Laboratorio creativo (LUMENZA Studio) ✅ (2026-11-10)

**Implementado**
- **Pipeline asíncrono** (`docs/PROCESAMIENTO_IMAGENES.md`): la API valida cabecera, guarda el original y encola (202); el worker (`apps/api/src/worker.ts`) sanea el original (sin EXIF/GPS, auto-orientado, sin filtros) y genera con **Sharp** display 1440, miniatura 640 y las 3 transformaciones reales (`bw_editorial`, `sepia_cinema`, `lumen_tone`, ≤1800 px WebP). Todo en S3 (RustFS/Amazon S3) + `photo_variants` con `params` (receta).
- **Cola**: `pg-boss` sobre PostgreSQL (sin Redis): reintentos con backoff, expiración de trabajos activos (recuperación de worker caído), política `exclusive`+`singletonKey`, barrido que re-encola atascadas y fotos de la Fase 3 sin transformaciones.
- **Estados**: `pending→processing→ready|partial|failed` con `progress`, `stage`, `attempts`, `last_error`, `processed_by`; error permanente (imagen dañada) sin gastar reintentos; `partial` usable; `POST /api/posts/:id/reprocess` (solo autor).
- **Privacidad**: variantes servidas por `/api/media/photo/:id/:variante` con control de visibilidad; el **original** y `?download=1` solo autor o con descarga permitida; fotos pendientes ocultas a otros usuarios (feed/explorar/detalle); original sin sanear no se sirve.
- **Eliminación**: borra filas y objetos (claves deterministas) y el worker limpia si la publicación desaparece durante el proceso.
- **LUMENZA Studio** (detalle `/p/:id#studio`): escenario grande, selector de las 4 versiones con miniaturas, comparador antes/después (ratón, táctil, teclado `role=slider`), ficha técnica con receta real, descarga autorizada, pantalla completa, panel de procesamiento con progreso real, estados fallo/parcial con reintento. Feed: tarjeta con estado en vivo y acceso a Studio; perfil muestra placeholders de procesamiento.
- **Docker**: `apps/api/Dockerfile` (multi-etapa), `.dockerignore`, servicio `worker` (perfil `worker`, `mem_limit 1g`).
- **Migración 004** aplicada. Herramientas: `npm run dev:worker`, `preview:transforms`, `seed:demo`.

**Pruebas ejecutadas (reales)**
- typecheck 0 errores · build ✔ · `npm audit` 0 · `/api/ready` 200.
- Unitarias 8/8 · **Integración 62/62** (PostgreSQL+RustFS+Mailpit+worker real): +10 del pipeline — 3 transformaciones reales verificadas por estadísticas de color (B/N canales iguales, sepia R>G>B, tono LUMENZA desplazado al azul, 3 distintas entre sí y del original), miniatura, original conservado sin EXIF con sha256 coherente, orientación EXIF, imagen de 35 MP y rechazo >60 MP, corrupta→failed sin reintentos + reproceso, reintento ante fallos de almacenamiento (idempotente), `partial`→reproceso→ready, **caída del worker** (pg-boss reentrega y otro worker completa), pendientes ocultas a terceros, **borrado durante el proceso sin objetos huérfanos**, privacidad de todas las variantes y reglas de descarga. Las 52 previas siguen verdes.
- **E2E Playwright (Edge, worker real) 18/18**: 5 auth + 3 sociales (adaptados) + 10 Studio (4 versiones cargan imágenes distintas, comparador por teclado/ratón/**táctil CDP**, pantalla completa, descarga, feed se actualiza sin recargar, fallo+reintento, privacidad, reduced-motion, 320/375/768/1024/1440 en oscuro y claro sin desbordamiento).
- **Worker en Docker verificado**: el contenedor procesó una foto real (`processed_by` = id del contenedor; 5 variantes) y completó sola un trabajo que esperaba en cola.
- Visual (navegador): Studio con comparador, procesando (oscuro 1000 px y claro 375 px), transición automática a Studio. Corregidos: solapamiento del panel de procesamiento, etiquetas truncadas del selector, perilla del comparador recortada.

**Limitaciones / pendiente**
- Sin detección de rostros (Fase 5). Sin revisión visual del modo inmersivo en móvil ni del estado «failed/partial» (solo probados por E2E/DOM).
- Las recetas se validaron con escenas sintéticas; falta revisarlas con fotografías reales con licencia clara. Hay textos con carácter dañado en 0 publicaciones demo (eliminadas).
- Worker sin healthcheck HTTP (solo `restart: unless-stopped`); sin Dockerfile del frontend ni compose completo (Fase 8).
- Bundle JS sin dividir (>500 kB), perfiles: portada/edición de publicaciones, notificaciones UI (Fase 6).
- **Pendientes obligatorios antes de la entrega**: Google OAuth real, reCAPTCHA real, SMTP de producción; revisión visual de pantallas restantes; optimización del bundle.

## Fase 5 — Detección de rostros ✅ (2026-11-10)
Documentación: `docs/DETECCION_ROSTROS.md` (tecnología, privacidad, limitaciones). Plan de lo siguiente: `docs/PLAN_SEGURIDAD_Y_EVALUACION.md`.

**Implementado**
- `@vladmandic/face-api` 1.7.15 (MIT, fork mantenido de face-api.js) + TensorFlow.js **WASM** (sin compilación nativa), solo red SSD MobileNet v1 de detección, en el worker (`apps/api/src/faces/detector.ts`, paso 98 % del pipeline). Lee la imagen por `StorageService` (RustFS hoy / S3 después).
- Migración **005**: `photos.faces_status` (`pending|done|failed`), `faces_model`; `photos.faces` guarda **solo** `{x,y,w,h,score}` normalizados sobre la imagen orientada. Sin landmarks, descriptores, recortes ni atributos; sin objetos extra en S3.
- Si el detector falla, la foto queda `ready` y `faces_status=failed`; `POST /api/posts/:id/faces/reanalyze` (solo autor) repite sin cambiar el estado visible. Las fotos anteriores se analizan en segundo plano sin reprocesar variantes.
- Los resultados siguen la visibilidad de la foto (privada → solo autor).
- UI en LUMENZA Studio: botón «Rostros N» (`aria-pressed`, preferencia en el navegador), recuadros numerados de doble trazo legibles en claro/oscuro, resumen accesible con aviso «solo localización», funciona con versiones, comparador y pantalla completa; aviso de privacidad en el modal de publicar (no usa la cámara).

**Pruebas ejecutadas (reales, tras los últimos cambios)**
- typecheck 0 errores · build ✔ · `npm audit` 0 · `/api/ready` 200.
- Unitarias 8/8 · **Integración 69/69** (+7 de rostros con detector real): 1 rostro con IoU>0,5 contra anotación manual, 2 rostros en composición, 0 rostros, orientación EXIF, privacidad (privada→404, pública visible), detector que falla→`failed`→reanálisis, análisis de fotos antiguas sin pasar a `processing`; verificación de que solo se guardan `{x,y,w,h,score}`, no hay columnas biométricas y siguen 6 objetos por foto.
- **E2E Playwright 26/26** (+8 de rostros): contador, recuadros dentro del escenario y numerados, activar/desactivar con persistencia, versión/comparador/pantalla completa, sin rostros (botón deshabilitado), privacidad, aviso al publicar, y 320/375/768/1024/1440 en oscuro y claro. Un desbordamiento real a 320/375 px (barra de Studio) se corrigió y los E2E de Studio siguen en verde.
- **Docker**: la nueva imagen del worker detectó el rostro de un retrato real (`processed_by` = id del contenedor).
- Visual: recuadro preciso sobre el rostro en oscuro (1000 px) y claro (375 px).

**Limitaciones**: detector ligero (rostros muy pequeños/ocluidos/de perfil pueden fallar; posibles falsos positivos); sin evaluación estadística de precisión con dataset anotado; probado con retratos de dominio público y composiciones, no con un conjunto diverso; ~0,8 s por imagen en CPU.

## Siguientes incrementos (planificados, NO implementados) — ver `docs/PLAN_SEGURIDAD_Y_EVALUACION.md`
A) MFA TOTP (activación con código, códigos de recuperación, límites de intentos, admin obligatorio, Google OAuth no omite MFA) · B) Passkeys WebAuthn (evaluación + implementación opcional) · C) Cuenta del evaluador con datos controlados, reset y sin contraseñas en el repo.
**Pendientes obligatorios antes de la entrega**: Google OAuth real, reCAPTCHA real y SMTP de producción (no declarados completos hasta probarlos con credenciales reales); revisión visual de pantallas restantes; optimización del bundle; Dockerfile del frontend, compose completo y manifiestos AKS/AWS (sin crear recursos facturables).

## Incremento A — MFA TOTP ✅ (2026-11-10)
Documentación: `docs/SEGURIDAD_MFA.md` · plan: `docs/PLAN_SEGURIDAD_Y_EVALUACION.md`.

**Implementado**
- Migración **006** (`user_mfa`, `mfa_recovery_codes`, `mfa_challenges`, `sessions.scope/mfa_verified_at`). Backend `apps/api/src/modules/mfa/*` (crypto, repositorio, servicio, rutas) y `otplib` 13 + `qrcode`.
- **Activación/desactivación segura** desde `/ajustes/seguridad`: contraseña actual (o sesión ≤10 min en cuentas solo-Google), QR + clave manual compatibles con Google/Microsoft Authenticator, **solo se activa con un código válido**, 10 códigos de recuperación de un solo uso (solo HMAC en BD) y cierre de otras sesiones. Regenerar/desactivar exigen contraseña **y** un factor válido; un admin no puede desactivar.
- **Login en dos pasos**: contraseña correcta ⇒ sin sesión; desafío de un solo uso (cookie `lz_mfa` HttpOnly, 10 min) ⇒ `/login/mfa`. **Google OAuth no omite MFA** (mismo desafío). **Administradores**: MFA obligatorio (sesión de alcance `mfa_setup`, resto de la API 403 hasta enrolar).
- **Secretos cifrados** AES-256-GCM (AAD = usuario) con `MFA_ENCRYPTION_KEY` **separada de `SESSION_SECRET`**; sin clave el MFA se deshabilita y en producción la API no arranca.
- **Fuerza bruta/reutilización**: paso TOTP usado guardado atómicamente (anti-replay, ventana ±1), 5 intentos por desafío, 10 fallos/15 min por usuario ⇒ 429 `mfa_locked` (incluso con código correcto), límite por IP, auditoría `auth.mfa_*` sin secretos.
- UI: `LoginMfa`, `SecuritySettings` (asistente con QR, códigos descargables/copiables con confirmación, regenerar/desactivar), `CodeInput` accesible (`one-time-code`), enlace «Ajustes» en la navegación.

**Pruebas ejecutadas (reales, tras los últimos cambios)**
- typecheck 0 errores · build ✔ · `npm audit` 0 · `/api/ready` 200.
- **Unitarias 15/15** (+7 MFA: vectores oficiales RFC 6238 en la implementación independiente **y** en otplib, cifrado/AAD/manipulación, códigos de recuperación).
- **Integración 84/84** (+15 MFA con TOTP independiente): setup/CSRF/contraseña/QR/cifrado, enable (inválido/válido/10 códigos/sesiones), login 2 pasos + replay + deriva ±1, bloqueo por fuerza bruta, recuperación de un solo uso, desafío caducado/consumido, límite por IP real, **Google+MFA**, cuenta solo-Google (reauth reciente), desactivar/regenerar, reset de contraseña mantiene MFA, admin obligatorio (también vía Google), sin clave ⇒ 503, auditoría sin secretos.
- **E2E Playwright 37/37** (+11 MFA con TOTP real): activación completa por UI (QR real, código inválido, descarga de códigos), login en dos pasos, recuperación, regenerar/desactivar, admin, desafío caducado, y 320/375/768/1024/1440 en oscuro y claro sin desbordamiento. Los 26 previos siguen verdes.
- **Bugs encontrados por las pruebas y corregidos**: (1) el callback de Google no leía `mfa_enabled` y dejaba entrar sin segundo factor → ahora `gate()` consulta siempre la BD; (2) tras equivocarse de contraseña se borraba el código TOTP; (3) selector ambiguo «Activar»/«Desactivar» solo en la prueba.
- Visual (navegador): Ajustes (oscuro, escritorio), asistente con QR (claro, móvil), paso MFA del login (claro, móvil).

**Limitaciones**: sin recuperación autoservicio si se pierden dispositivo y códigos (requiere operador; aún no hay herramienta administrativa); sin rotación de `MFA_ENCRYPTION_KEY` (solo prefijo `v1`), sin correo de aviso al activar/desactivar, sin «recordar navegador»; Google+MFA probado con proveedor simulado; sin pruebas de carga del bloqueo.

## Pendiente (en este orden)
B) Passkeys WebAuthn (evaluación + implementación opcional) · C) Cuenta del evaluador (datos controlados, reset, sin contraseña en el repo).
**Pendientes obligatorios antes de la entrega**: Google OAuth real, reCAPTCHA real y SMTP de producción (no se declaran completos sin credenciales reales); revisión visual de pantallas restantes; optimización del bundle; Dockerfile del frontend, compose completo y manifiestos AKS/AWS (sin recursos facturables); configurar `MFA_ENCRYPTION_KEY` real en producción (gestor de secretos).


## Preparación del despliegue en AWS EC2 (2026-11-10/11) — preparado, NO desplegado
Runbook paso a paso: `docs/DESPLIEGUE_AWS_EC2.md`. Archivos: `deploy/aws/{docker-compose.aws.yml,.env.aws.example,lumenza.sh,pack-for-ec2.sh,iam-policy-s3.example.json,docker-compose.localtest.yml}`, `apps/web/Dockerfile`, `apps/web/nginx/*`, `.gitattributes`; `apps/api/Dockerfile` y el `docker-compose.yml` de desarrollo sin cambios funcionales.

**Hecho y verificado localmente (proyecto Docker aislado `lumenzaaws`, S3 sustituido por RustFS solo en la prueba)**
- Construcción de imágenes (api 862 MB, web 95 MB); arranque desde BD vacía con las 6 migraciones; `migrate → api/worker → web`; todos *healthy*; `./lumenza.sh health` completo en verde (Nginx, SPA, API, PostgreSQL, S3, 401 en rutas privadas, cabeceras, no exposición de puertos).
- Registro/login/publicación y procesamiento de fotos de 12, 35, 48 y 60 MP a través de Nginx; imágenes visibles en el navegador con CSP estricta (0 violaciones).
- **Memoria medida** (ver tabla del runbook): picos db 78 MiB, api 112 MiB, worker 477–768 MiB, web 9 MiB ⇒ ≈ 970 MiB; **viable en 2 GiB con swap de 2 GiB, un solo procesamiento a la vez y compilando las imágenes fuera de la EC2**; no apto para carga real. Disco ≈ 1,6 GB de imágenes; fotos en S3.
- Respaldo → borrado → restauración verificada; `stop/start/restart/down+up` con persistencia; modo HTTPS probado con certificado autofirmado (301, HSTS en todas las rutas, se niega a arrancar sin certificado); la API en producción sale con código 1 si faltan secretos/integraciones y arranca con advertencias solo con `ALLOW_MISSING_INTEGRATIONS=true`.
- **Fallos reales encontrados y corregidos durante las pruebas**: (1) `pg_restore --clean` no funciona con las tablas particionadas de pg-boss y dejaba los servicios detenidos → restauración rediseñada (recrear BD + restaurar sobre base vacía, con vuelta atrás automática); (2) HSTS desaparecía en las rutas con `add_header` propios → `headers.inc` incluido en cada `location`; (3) finales de línea CRLF (Windows) rompen el script de arranque de Nginx en Linux → `.gitattributes` + `dos2unix` en la imagen; (4) HSTS duplicado API+Nginx; (5) la CSP estricta exigió mover el script del tema a `public/theme-init.js`.
- Cambios mínimos en la aplicación: `COOKIE_SECURE` y `ALLOW_MISSING_INTEGRATIONS` explícitos (`env.ts`), latido del worker para su healthcheck (`worker.ts`), `theme-init.js`.

**Pruebas del proyecto tras estos cambios (2026-11-11, repetidas tras recuperar Docker Desktop)**: typecheck 0 errores · unitarias 15/15 · integración 84/84 · **E2E 37/37** · build ✔ · `npm audit` 0. (Una primera ejecución de E2E quedó invalidada por la caída del motor WSL de Docker Desktop y se repitió completa.)

**No verificado (requiere AWS real)**: S3 con el **rol IAM** y IMDSv2 desde contenedores (hop limit 2), Let's Encrypt, HTTP/2, compilación y tiempos en un t3.small, correo, Google y reCAPTCHA reales.
**Pendientes externos**: security group, IMDS hop limit 2, política IAM del rol, endurecimiento del bucket, IP elástica, dominio + certificado, SMTP real (SES), reCAPTCHA, Google OAuth, guardar `MFA_ENCRYPTION_KEY`/`POSTGRES_PASSWORD` fuera de la instancia. **Limpieza hecha**: contenedores y volúmenes de prueba `lumenzaaws-*` (proyecto del stack de AWS en local) eliminados. **Pendiente de decidir**: 8 usuarios de prueba (`fa*`, `fr*`) que dejó la ejecución interrumpida de los E2E de rostros, y sus objetos en RustFS.

## Fase 6 — Avisos en tiempo real, perfiles privados y edición (implementada y probada en local; NO desplegada — ver «Estado de LUMENZA 2.0» al final)
- Migración `007_privacy_notifications_edit.sql`: `follow_requests`, `posts.edited_at`, `posts.cover_variant`, tipos de aviso `follow_request` y `follow_accepted`.
- SSE: `GET /api/events` (cookie de sesión). Los eventos viajan por PostgreSQL `LISTEN/NOTIFY` (`apps/api/src/events/hub.ts`), de modo que el worker (otro proceso) también avisa cuando una foto queda lista. Sin Redis. Nginx no requiere cambios (`X-Accel-Buffering: no` y latido cada 25 s).
- Avisos: `GET /api/notifications`, `/notifications/unread-count`, `POST /notifications/read`; preferencias por tipo en `PATCH /api/me/settings`.
- Perfiles privados: solicitud de seguimiento, aceptar/rechazar (`/api/me/follow-requests`), contenido y listas bloqueados a no seguidores; volver público acepta las pendientes.
- Edición: `PATCH /api/posts/:id` (texto, etiquetas, categoría, visibilidad, descarga y versión mostrada en el inicio: solo quien publica).
- Sugerencias con motivo (te sigue, conocidos en común, intereses, popularidad) y etiquetas en tendencia.
- Web: página `/notificaciones`, insignia de no leídos, título de pestaña, sonidos sintetizados (Web Audio, silenciables, guardados en el dispositivo), botón «N publicaciones nuevas», ajustes en `/ajustes/privacidad`.
- Estado de verificación (actualizado 2026-11-12): las pruebas de integración de esta fase **sí se ejecutaron** con PostgreSQL, RustFS y Mailpit reales (ver «Estado de LUMENZA 2.0»). El texto anterior («escritas pero NO ejecutadas») quedó obsoleto y se conserva solo como historial.
- Pendiente (no implementado): avisos y códigos TOTP por correo (requieren SMTP real); bloqueo de usuarios.

## Estado de LUMENZA 2.0 (actualizado 2026-11-12) — implementada y probada en local · NO desplegada

> Convención de este apartado: **Implementado** = existe en el código local · **Probado** = hay una ejecución automatizada real que lo respalda (cifras abajo) · **Desplegado** = corre en AWS · **Pendiente de pruebas** / **Pendiente de implementación** = aún no. **Nada de la 2.0 está desplegado ni commiteado.**
> La nota «NO desplegado» de la sección *Preparación del despliegue en AWS EC2* es histórica (2026-11-10/11). Según el equipo, la versión anterior (sin Fase 6, migraciones 001–006) ya corre en una EC2 (`lumenza.duckdns.org`); eso **no se ha verificado en esta sesión** y no se ha tocado AWS.

### Qué hay en cada entorno
| Capacidad | Implementado (local) | Probado (local) | Desplegado en AWS | Pendiente |
|---|---|---|---|---|
| Registro, login, sesiones, Google OAuth, reCAPTCHA, verificación/recuperación por correo | sí (versión 1) | sí (integración, Google con proveedor simulado) | sí (versión 1, según el equipo; correo sin SMTP real) | Google, reCAPTCHA y SMTP reales; SES |
| MFA TOTP | sí (versión 1) | sí (integración + E2E) | según el equipo, con la versión 1 | `MFA_ENCRYPTION_KEY` real en producción |
| Publicar, feed, explorar, perfiles, seguir, like, comentar, guardar | sí (versión 1) | sí | sí (versión 1) | — |
| Procesamiento Sharp (5 variantes + rostros) con pg-boss | sí (versión 1) | sí (integración + E2E) | sí (versión 1) | investigar un trabajo de 70,9 s |
| **Avisos en tiempo real (SSE `GET /api/events`) sobre `LISTEN/NOTIFY`** | sí | sí (36 pruebas) | **no** | probar en navegador real y tras Nginx |
| **Cierre de conexiones SSE al revocar sesión** (logout, cambio de contraseña, vincular Google, revocar otras sesiones, caducidad) | sí | sí | **no** | política fail-closed con margen |
| **Notificaciones** (campana, contador, leídos, preferencias por tipo) | sí | sí | **no** | — |
| **Perfiles privados** (solicitudes, aceptar/rechazar, listas bloqueadas) | sí | sí | **no** | — |
| **Editar publicación** (texto, etiquetas, categoría, visibilidad, versión mostrada) | sí | sí | **no** | — |
| Sonidos (Web Audio, silenciables), sugerencias con motivo, etiquetas en tendencia | sí | parcial (API sí; sonido y UI solo revisados en código) | **no** | validación visual y de audio en navegador |
| Migración `007_privacy_notifications_edit.sql` (aditiva: sin DROP ni DELETE) | sí | sí (BD local) | **no** (se aplicaría con `./lumenza.sh up`) | respaldo previo en la EC2 |
| Avisos y códigos por correo (OTP), bloqueo de usuarios | no | — | — | pendiente de implementación |

### Pruebas automatizadas (reales, entorno local: PostgreSQL 17, RustFS, Mailpit, worker)
| Suite | Resultado | Observaciones |
|---|---|---|
| Typecheck API y web | 0 errores | `tsc` del web **no** incluye `apps/web/e2e` (Playwright las transpila sin comprobar tipos) |
| Build | correcto | aviso de chunks > 500 kB (ya conocido) |
| Unitarias | 15/15 | |
| Integración | **125/125** (10 archivos) | incluye `privacy.integration.test.ts` (5) y `events.integration.test.ts` (36); una corrida anterior tuvo 5 timeouts de worker/S3 por carga de la máquina |
| SSE (`events.integration.test.ts`) | **36/36**, 3 corridas seguidas | tres usuarios; audiencias, notificaciones, edición/borrado, reconexión, límites, latidos, caída del oyente LISTEN, revocación de sesiones |
| MFA E2E (`mfa.spec.ts`) | 11/11 ×3 | el test `:66` pasó 24/24 repeticiones tras corregirlo |
| Social E2E (`social.spec.ts`) | 3/3 ×3; el flujo `:11` pasó 10/10 | |
| Regresión E2E auth+social+MFA | **19/19 en dos corridas** (Paso 6) | |
| E2E completo de 6 archivos (37) | última ejecución completa en el Paso 2: 35 pasaron y 2 dieron timeout; repetidos pasaron 10/10 | **`faces.spec.ts` y `studio.spec.ts` no se han vuelto a ejecutar tras los cambios de sesión/SSE** |

### Correcciones realizadas durante esta ronda
1. `PATCH /posts/:id` devolvía 500 por un SQL con el marcador `$n` mal formado (lo detectó la prueba de integración).
2. Fixtures de integración que otro worker reprocesaba (publicaciones «listas» sin variantes): ahora se insertan completas en una sola transacción.
3. **S16**: el cierre de sesión no cortaba el flujo SSE abierto. Ahora cada conexión se liga al hash de su sesión; el logout cierra en dos fases (antes y después de revocar), las revocaciones masivas cierran tras el `COMMIT`, y un único temporizador del hub revalida sesiones cada 25 s (cubre caducidad y revocación externa).
4. Frontend: al cerrar sesión se eliminan las consultas en caché del usuario anterior (se conserva `me`; un primer intento con `queryClient.clear()` rompió el logout y lo detectó el E2E) y `EventSource` se reabre tras 5 s solo si la sesión sigue siendo válida.
5. Test MFA `:66`: dependía del reloj (cruce de la ventana TOTP de 30 s). Ahora usa el paso realmente gastado leído de la BD y verifica reutilizado vs caducado en `audit_log`. **No se modificó la seguridad TOTP.**
6. Test social `:11`: timeout propio de 120 s (medido: 53–105 s con la máquina cargada) y límite de 60 s para el procesamiento con mensaje que indica la etapa del worker. No se tocó el pipeline.

### Seguridad SSE y cierre de sesiones (resumen técnico)
- Autenticación por cookie de sesión; sin sesión 401. Eventos con **solo identificadores** (sin texto de publicaciones ni comentarios).
- Audiencia: privada → solo la autora; «solo seguidores» o perfil privado → seguidores + autora; pública → todos los conectados. Los cambios de permisos se aplican al siguiente evento sin reconectar.
- Reconexión sin reproducción de eventos pasados (no hay `Last-Event-ID`). Máximo 5 conexiones por usuario (se expulsa la más antigua). Latido cada 25 s con un único temporizador, activo solo mientras hay conexiones.
- Revocación inmediata por la API; revocación por otra vía (BD directa, otra réplica) detectada en ≤ 25 s. Si falla la revalidación contra PostgreSQL **no se cierra nada** (fail-open transitorio): decisión pendiente (ver riesgos).
- El hash de sesión solo vive en memoria; no se registra ni se envía en eventos. Cubierto por la prueba S24.

### Arquitectura
React 19 + Vite + Tailwind 4 (TanStack Query, `EventSource`, Web Audio) → Nginx (contenedor web) → Express 5 + TypeScript (rutas → servicios/repositorios → `pg`, Zod) → PostgreSQL 17 (datos, sesiones, pg-boss y `LISTEN/NOTIFY`) · Worker Node (Sharp: `display`, `thumbnail`, `bw_editorial`, `sepia_cinema`, `lumen_tone` + detección de rostros) consume la cola de pg-boss · imágenes solo en S3 (`StorageService`: RustFS en local, Amazon S3 con rol IAM en AWS), la BD guarda `bucket` + `storage_key` + metadatos · Docker Compose (db, api, worker, web, migrate).

### Procesamiento fotográfico (medido en local)
- Histórico de 162 trabajos de la cola E2E: espera en cola p50 0,5 s / p90 0,9 s; procesamiento p50 4,6 s / p90 7,2 s; máximo 15,5 s en el histórico completo, **salvo un trabajo de 70,9 s** (2026-11-12 04:56 UTC, durante una sesión con la máquina muy cargada) y otros de 34–52 s en la misma ventana.
- Verificación final del Paso 6: procesamiento 4,7–19,4 s, cola ≤ 1 s, 0 reintentos.

### Riesgos abiertos y siguientes fases
**Riesgos abiertos (todos pendientes)**
1. **Trabajo histórico del worker de 70,9 s**: sin investigar. Superaría el límite de 60 s del test; la causa probable es la carga de la máquina (el proyecto está dentro de OneDrive), sin confirmar.
2. `faces.spec.ts` y `studio.spec.ts`: dieron timeouts en el Paso 2 y no se han vuelto a revisar; el timeout global de 45 s probablemente les afecta.
3. Política **fail-closed con margen** para SSE (cerrar todas las conexiones tras ~3 revalidaciones fallidas seguidas) y guardia contra pasadas solapadas.
4. **Bucle de reconexión con más de 5 pestañas**: la expulsada reconecta a los 4 s y expulsa a otra; cada `ready` recarga feed y avisos. Posible solución: responder 204 a la conexión sobrante.
5. **Limpieza de caché tras un 401** sin pasar por logout (la caché del usuario anterior sigue hasta que se refresque).
6. Pruebas reales de SSE **en navegador y a través de Nginx** (búfer, `proxy_read_timeout 60s`; falta un `location` propio para `/api/events`).
7. **Amazon SES** y correos de verificación/recuperación: sin configurar (producción sin SMTP real). DuckDNS no permite los CNAME de DKIM: verificar una dirección o usar un dominio propio.
8. **Despliegue de LUMENZA 2.0 a AWS**: pendiente (empaquetar, respaldo en la EC2, `load`, `up` con la migración 007, `health`).
9. **Validación visual y responsive** del frontend nuevo (notificaciones, privacidad, edición, sonidos): solo revisada en código.
10. Revocación con varias réplicas de API: `closeSession` actúa solo en el proceso local (el resto, en ≤ 25 s). Irrelevante con un único contenedor.
11. Integración/E2E de las publicaciones «creadas» entran por `hub.publish` en las pruebas SSE, no por el pipeline completo de subida.
12. Exposición oral y participación del grupo: pendientes de verificar.
13. Pendientes previos sin cambios: Google OAuth, reCAPTCHA y SMTP reales; Passkeys (opcional); cuenta del evaluador; optimización del bundle; decidir sobre `PROMPT_MAESTRO.md` (aparece borrado en el árbol de trabajo, sin tocar).

**Siguientes fases propuestas (cada una con pruebas y cierre en este archivo)**: commit local → revisión visual/responsive → atender riesgos 1–6 → Nginx/`location` de SSE y prueba en navegador → SES → despliegue con respaldo y reversión → exposición.

### Matriz de seguimiento de la rúbrica (5 criterios × 20 puntos)
> El texto oficial de la rúbrica **no está en el repositorio**. La columna «Requisitos» resume lo que el equipo declaró para cada criterio y debe contrastarse con el documento oficial. **No se asignan puntajes**: ninguna cifra de esta tabla es una calificación obtenida.

| Criterio (20 pts) | Requisitos (según el equipo) | Evidencias disponibles | Estado real | Pendiente |
|---|---|---|---|---|
| **Frontend** | Funcionalidad y manejo de estados; autenticación estable; interfaz responsive y accesible | React 19 + Tailwind 4; tokens de diseño claro/oscuro; E2E de registro, login, MFA, publicar, interactuar, explorar, seguir y eliminar; revisión responsive 320–1440 px en las pantallas de la versión 1; estados de carga/error | Versión 1 completa y probada; las pantallas nuevas (avisos, privacidad, edición) funcionan por E2E parcial y API, sin revisión visual completa | Validación visual/responsive y de audio de lo nuevo; pruebas en navegador de SSE; caché tras 401; bucle >5 pestañas |
| **Backend** | Seguridad, validaciones y manejo de errores; integración con PostgreSQL, worker y S3 | Zod, autorización por recurso, sesiones con hash, MFA TOTP cifrado, límites de intentos, SSE con filtrado de audiencia y cierre por sesión revocada; 125 pruebas de integración; 15 unitarias | Sólido y probado en local | Fail-closed con margen; investigar trabajo de 70,9 s; SES/SMTP, Google y reCAPTCHA reales |
| **Participación grupal** | Cada integrante entiende y puede explicar el proyecto | Documentación técnica (`docs/`, `DECISIONES_TECNICAS.md`, este archivo) | **No verificable desde el repositorio** | Verificar con el grupo; repasar los puntos técnicos de abajo |
| **Despliegue en la nube** | Aplicación estable en la nube con configuración segura | Versión 1 en EC2 según el equipo; runbook `docs/DESPLIEGUE_AWS_EC2.md`; `lumenza.sh` (backup, restore, health); empaquetado con comprobaciones de secretos (reforzado en el Paso 7) | La 2.0 **no** está desplegada | Empaquetar, respaldo, migración 007, `health`, prueba SSE tras Nginx, plan de reversión |
| **Informe final** | Evidencia reproducible de pruebas, decisiones y resultados | Este archivo, `DECISIONES_TECNICAS.md`, `docs/*`; cifras de pruebas con comandos reproducibles | Evidencia abundante, informe final no redactado | Redactar el informe con resultados, riesgos y trabajo pendiente honestos |

**Puntos técnicos que todo el grupo debería poder explicar**: SSE frente a WebSocket y por qué `LISTEN/NOTIFY` sin Redis; filtrado de audiencia por visibilidad y perfil privado; por qué los eventos llevan solo ids; cierre de sesión en dos fases y revalidación periódica; fail-open frente a fail-closed; TOTP (ventana ±1, anti-replay con `last_used_step`, secretos cifrados); pipeline Sharp + pg-boss + S3 (la BD nunca guarda imágenes); por qué la migración 007 es aditiva y cómo se revierte el despliegue.

### Empaquetado seguro (`deploy/aws/pack-for-ec2.sh`, reforzado el 2026-11-12; sin ejecutar el empaquetado real)
- Mismo resultado y formato (`lumenza-deploy.tar.gz` + `lumenza-deploy.sha256`, mismas raíces y rutas relativas): el procedimiento del runbook no cambia. Nuevo: `bash deploy/aws/pack-for-ec2.sh --check` valida la lista sin crear paquete.
- Antes: exclusiones por patrón de `tar`; `deploy/aws/.env.localtest.tls` **no** estaba excluido (la comprobación final lo habría detectado y borrado el paquete, pero el empaquetado no funcionaba). Ahora: lista blanca de raíces + recorrido con `find` + filtro por nombre (sin distinguir mayúsculas) a cualquier profundidad: `.env` reales y variantes (solo se conservan `.env.example` y `.env.aws.example`), claves y certificados (`.pem .key .p12 .pfx .crt …`, `id_rsa*`, `id_ed25519*`), volcados/respaldos/`.tar`/`.zip`/temporales, `.npmrc`, `credentials`/`secrets` en formatos de datos; carpetas `node_modules`, `.git`, `dist`, `backups`, `.aws`, `.ssh`, etc.
- Aborta (código 1, sin dejar paquete) si hay enlaces simbólicos, archivos especiales o archivos de más de 50 MB; busca patrones de credenciales en el contenido de lo que sí entra (imprime solo nombres de archivo, nunca valores); y valida de nuevo el paquete creado (rutas absolutas o con `..`, enlaces, raíces permitidas, nombres sensibles).
- Comparación con la lista del script anterior sobre el repositorio real: idéntica salvo que ahora queda fuera `deploy/aws/.env.localtest.tls` (209 entradas frente a 210). Un primer borrador excluía por error `credentials.service.ts` (código fuente); lo detectó el `--check` real y se corrigió con una prueba de regresión.
- Pruebas en un árbol ficticio aislado (secretos inventados): 34 PASS, 0 FAIL, 1 SKIP (el caso de enlace simbólico no se pudo reproducir en este Windows: está cubierto solo por revisión estática, a repetir en WSL/Linux). Pendiente: ejecutar el empaquetado real cuando se autorice el despliegue.

### Cómo reproducir las pruebas
`docker compose up -d --wait db rustfs mailpit` · `npm run migrate` · `npm run typecheck` · `npm test` · `npm run test:integration -w @lumenza/api` · `npm run e2e -w @lumenza/web` (o archivos concretos: `auth.spec.ts social.spec.ts mfa.spec.ts`) · `npm run build`. Aislar cada corrida E2E: no lanzar dos a la vez ni cortarlas con `timeout` (deja publicaciones huérfanas que hacen fallar la búsqueda «mañana»).
