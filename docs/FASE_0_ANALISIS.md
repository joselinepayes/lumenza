# LUMENZA — Fase 0: Análisis y diseño

> «Cada mirada cuenta una historia»

## 1. Requisitos

### 1.1 Funcionales (RF)
| ID | Requisito |
|----|-----------|
| RF-01 | Landing pública, registro e inicio de sesión (email/contraseña) |
| RF-02 | Google OAuth real + reCAPTCHA validado en backend |
| RF-03 | Verificación de correo, recuperación de contraseña, logout, sesiones |
| RF-04 | Feed con carga incremental (cursor), likes, comentarios, guardados, compartir |
| RF-05 | Explorar: masonry, búsqueda de posts/usuarios/hashtags, categorías |
| RF-06 | Perfil: avatar, portada, bio, estadísticas, seguir/dejar de seguir, edición |
| RF-07 | Publicar: drag&drop, validación servidor (magic bytes), descripción, tags, categoría, visibilidad |
| RF-08 | Laboratorio creativo: original + 3 transformaciones reales (Sharp) + miniatura, comparador, descarga autorizada |
| RF-09 | Detección de rostros con cuadros delimitadores (sin identificación biométrica) |
| RF-10 | Notificaciones (seguidores, likes, comentarios), leídas/historial |
| RF-11 | Configuración: datos, contraseña, tema, privacidad, notificaciones, sesiones, borrar cuenta |
| RF-12 | Almacenamiento en S3 (abstracción `StorageService`), BD solo guarda claves/metadatos |
| RF-13 | Procesamiento asíncrono con cola, reintentos y estados parciales |

### 1.2 No funcionales (RNF)
- **Seguridad**: Argon2id (sal individual), Zod en entradas, Helmet, CORS estricto, rate limiting, cookies HttpOnly/SameSite, CSRF, logs sin secretos, autorización por recurso.
- **Rendimiento**: paginación por cursor, miniaturas/AVIF-WebP, lazy loading, índices SQL.
- **Escalabilidad**: API stateless, sesiones en BD, archivos en S3, worker separado → escalado horizontal.
- **Accesibilidad**: WCAG AA, teclado, foco visible, `prefers-reduced-motion`.
- **Portabilidad**: Docker Compose local, manifiestos K8s (AKS) y alternativa AWS.
- **Mantenibilidad**: Routes → Controllers → Services → Repositories → DB; TypeScript estricto; pruebas.
- **Privacidad/ética**: detección de rostros informada, sin plantillas biométricas, sin inferir atributos sensibles.

### 1.3 Restricciones
- S3 es requisito literal; Azure Blob **no** lo sustituye sin autorización docente → `StorageService` con drivers `s3` y `local` (desarrollo; MinIO en Docker como S3 compatible).
- No desplegar recursos facturables sin autorización.
- Credenciales de Google/reCAPTCHA/AWS: se prepara la integración; los valores los aporta el usuario vía `.env`.

## 2. Matriz de cumplimiento académico
| # | Requisito del curso | Cumplimiento | Fase | Estado |
|---|---|---|---|---|
| 1 | Bienvenida, registro, autenticación | Landing + auth | 1–2 | Pendiente |
| 2 | Google Login + reCAPTCHA | OAuth2 (Google Identity) + verificación server-side | 2 | Pendiente (requiere claves) |
| 3 | Home con miniaturas | Feed + explorar | 3 | Pendiente |
| 4 | Subida de imágenes | Modal multi-paso, validación servidor | 4 | Pendiente |
| 5 | Reconocimiento (face-api/OpenCV) | face-api.js (WASM/tfjs-node) en worker, bounding boxes | 5 | Pendiente |
| 6 | 3 transformaciones por foto | Sharp: B/N editorial, sepia cine, color propio "Lumen" | 4 | Pendiente |
| 7 | Ver original + transformaciones | Laboratorio + comparador | 4 | Pendiente |
| 8 | Nube sin binarios en BD | S3 + claves en `photo_variants` | 4 | Pendiente |
| 9 | BD relacional (usuarios, fotos, ubicaciones) | PostgreSQL; `photos.storage_key`, `photo_variants.storage_key` (+ `bucket`, `region`) | 1 | **Esquema en Fase 1** |
| 10 | Hash con sal | Argon2id (sal aleatoria por contraseña embebida) | 2 | Pendiente |
| 11 | Docker + nube | Compose; K8s AKS; alternativa AWS EC2 | 8–9 | Pendiente |
| 12 | Documentación | `docs/` (20 puntos del prompt) | 9 | Parcial |

## 3. Arquitectura

```
 Navegador (React SPA) ──HTTPS──► Ingress / Nginx
                                     ├─► web  (estático, Nginx)
                                     └─► api  (Express, stateless) ──► PostgreSQL
                                              │  └─► Cola (pg-boss sobre PostgreSQL)
                                              ▼                    ▲
                                          StorageService ◄── worker (Sharp + face-api)
                                          (S3 | MinIO | local)
```
- **Cola**: `pg-boss` (usa PostgreSQL; evita Redis extra, reintentos y backoff incluidos).
- **Sesiones**: tabla `sessions` con token opaco hasheado (SHA-256) en cookie HttpOnly; revocables, listadas en Configuración.
- **Entrega de imágenes**: URLs prefirmadas de S3 de corta duración para privadas; públicas vía endpoint `/media/:id` con control de acceso.
- **Capas backend**: routes → controllers → services → repositories → `pg`.
- Decisiones detalladas: `DECISIONES_TECNICAS.md`.

## 4. Estructura de carpetas
```
LUMENZA/
├─ apps/
│  ├─ web/            # React + Vite + TS + Tailwind
│  │  └─ src/{app,components/ui,features/*,lib,pages,styles}
│  └─ api/            # Express + TS (también contiene el worker)
│     └─ src/{config,db,modules/<mod>/{routes,controller,service,repository,schema},
│            middleware,storage,jobs,lib,worker.ts,server.ts}
├─ db/migrations/     # SQL versionado
├─ deploy/{k8s,aws}/
├─ docs/
├─ docker-compose.yml  .env.example  .dockerignore
├─ PROGRESO.md  DECISIONES_TECNICAS.md
└─ package.json       # npm workspaces
```

## 5. Modelo de datos preliminar
`users`(id uuid, email, email_verified, username citext único, password_hash null si solo Google, google_sub, role, created_at) ·
`profiles`(user_id PK/FK, display_name, bio, avatar_key, cover_key, is_private, theme, notif_prefs jsonb) ·
`sessions`(id, user_id, token_hash, ip, user_agent, expires_at, revoked_at) ·
`posts`(id, author_id, caption, category, visibility, status, created_at) ·
`photos`(id, post_id, storage_provider, bucket, storage_key, mime, width, height, bytes, sha256, processing_status, faces jsonb, exif_summary jsonb) ·
`photo_variants`(id, photo_id, kind enum[thumbnail, bw_editorial, sepia_cinema, lumen_tone], bucket, storage_key, width, height, bytes, status) ·
`comments`, `likes`, `follows`, `saves`, `hashtags`, `post_hashtags`, `notifications`, `audit_log`, `email_tokens` (verificación/reset), `processing_jobs` gestionado por pg-boss.
Restricciones: FK con `ON DELETE CASCADE` donde corresponda, únicos compuestos (like, follow, save), `CHECK` (no auto-follow), índices por `(author_id, created_at DESC)`, trigram para búsqueda.
Esquema ejecutable: `db/migrations/001_init.sql`.

## 6. Mapa de navegación
Público: `/` landing · `/login` · `/registro` · `/verificar-correo` · `/recuperar` · `/restablecer`
Privado: `/inicio` (feed) · `/explorar` · `/p/:id` (detalle + laboratorio) · `/u/:username` (perfil; pestañas Publicaciones/Guardados) · `/notificaciones` · `/ajustes/{cuenta,privacidad,seguridad,notificaciones,apariencia}` · modal global **Publicar**
Estados: 401 → login, 403, 404, error genérico.
Desktop: sidebar izquierda + feed + panel derecho · Tablet: rail de iconos · Móvil: barra inferior (Inicio, Explorar, Publicar, Avisos, Perfil).

## 7. Sistema de diseño
- **Tokens** (CSS variables, Tailwind los consume): ver `apps/web/src/styles/tokens.css`. Oscuro: bg `#0B0B10`, surface `#15151D`, surface-2 `#1D1D29`, text `#F8F8FC`, text-2 `#A3A3B5`, accent `#9673F7`, accent-soft `#C4B5FD`, border `#292936`. Claro: bg `#FAFAFD`, surface `#FFF`, text `#181821`, text-2 `#737386`, accent `#7654D7`, border `#E8E8F0`.
- **Contraste**: `text-2` claro (#737386 sobre #FAFAFD ≈ 4.5:1) se valida; texto sobre acento usa blanco/oscuro según ratio.
- **Tipografía**: Inter (variable) para UI; display para marca/titulares con tracking amplio (Fraunces para titulares editoriales, ligera). Escala: 12/14/16/18/22/30/44/64.
- **Espaciado** base 4px; radios: 6 / 10 / 14 (sin pills excesivos); sombras mínimas (1 nivel sutil + halo de acento en foco).
- **Logo**: wordmark «LUMENZA» en mayúsculas con tracking ancho; marca gráfica = apertura de diafragma/obturador de 6 láminas formando una "L" de luz, SVG propio.
- **Iconos**: Lucide, trazo 1.75.
- **Movimiento**: 150/200/300 ms, ease-out `cubic-bezier(.2,.8,.2,1)`; reducido con `prefers-reduced-motion`.
- **Componentes base**: Button, IconButton, Input, Textarea, Select, Switch, Tabs, Avatar, Badge/Chip, Modal, Toast, Skeleton, EmptyState, ErrorState, Tooltip, Menu, Logo, ThemeToggle, PhotoTile, AppShell (Sidebar/Rail/BottomNav).
- **Tema**: `data-theme` en `<html>`; preferencia sistema por defecto + persistencia.

## 8. Pantallas
1. **Landing**: hero con composición asimétrica de fotografías (placeholders honestos de marca, no fotos "de usuarios"), titular editorial, CTA registro/login, sección "Laboratorio" mostrando las 3 transformaciones, sección rostros/privacidad, footer.
2. **Auth**: panel dividido (formulario + composición visual); validación inline, reCAPTCHA, botón Google, estados de carga/error; flujo verificar/recuperar.
3. **Feed**: columna central 640px, tarjetas sin marco pesado, foto a sangre, acciones (like, comentar, guardar, compartir), menú contextual, infinite scroll, skeletons.
4. **Explorar**: barra de búsqueda con pestañas (Fotos/Usuarios/Hashtags), chips de categorías, masonry, destacados.
5. **Detalle/Laboratorio**: visor grande, selector Original/B-N/Sepia/Lumen, comparador deslizante, panel de datos técnicos (dimensiones, peso, formato, EXIF seguro), cuadros de rostros activables, descarga según privacidad, comentarios.
6. **Perfil**: portada, avatar, stats, seguir, rejilla, pestaña Guardados (solo dueño), editar perfil.
7. **Publicar (modal 4 pasos)**: elegir → recortar/previsualizar → detalles (caption, tags, categoría, visibilidad) → procesamiento en vivo (estados de cola) → publicado.
8. **Notificaciones**: lista agrupada, marcar leídas.
9. **Ajustes**: secciones con navegación lateral; sesiones activas; borrar cuenta con confirmación por escritura.
10. **Estados**: 404/403/401/error.

## 9. Imágenes: almacenamiento y procesamiento
1. `POST /photos` (multipart, límite 15 MB, 1 archivo). Validación: tamaño, **magic bytes** (`file-type`), decodificación con Sharp (rechaza polyglots), límite de píxeles, re-encode sin EXIF/GPS.
2. Original → S3 `originals/{userId}/{photoId}.{ext}`; fila `photos` (`pending`) + job `process-photo` en pg-boss.
3. Worker: thumbnail 480px WebP; **bw_editorial** (greyscale, `normalise`, contraste + grano ligero), **sepia_cinema** (matriz sepia + viñeta, tono cálido), **lumen_tone** (saturación/gamma/tinte violeta en sombras, estilo propio); detección de rostros (face-api.js sobre tfjs-node/WASM) → bounding boxes en `photos.faces`, sin descriptores.
4. Cada variante → S3 `variants/{photoId}/{kind}.webp`; fila en `photo_variants`.
5. Estados: `pending → processing → ready | partial | failed`; reintentos 3× con backoff; variantes ya completadas no se rehacen (idempotente).
6. Acceso: bucket privado; URLs prefirmadas (5–15 min) tras comprobar visibilidad/seguidores.
7. Frontend: polling/SSE del estado hasta `ready`.

## 10. Plan por fases y aceptación
| Fase | Aceptación |
|---|---|
| 0 | Este documento revisado |
| 1 | `npm run dev` levanta web+api+Postgres; migración aplicada; `/health` ok; sistema de diseño visible en `/design`; landing con tema claro/oscuro |
| 2 | Registro/login/logout/reset/verify; Google y reCAPTCHA (con claves); hash Argon2id; pruebas de integración |
| 3 | Feed/perfil/follow/like/comment/save/explorar con datos reales de BD |
| 4 | Subida validada → S3/MinIO; thumb + 3 variantes en archivos reales; laboratorio |
| 5 | Worker con reintentos; bounding boxes de rostros |
| 6 | Notificaciones, ajustes, privacidad, búsqueda |
| 7 | Pruebas (unit/int/e2e), a11y, anchos 320–1440 |
| 8 | `docker compose up` desde cero funcional con healthchecks |
| 9 | Manifiestos K8s/AWS, docs completos; despliegue solo con autorización |

## 11. Decisiones pendientes del usuario
- ¿Azure AKS o AWS EC2 como destino principal? (afecta Fase 9)
- ¿El docente acepta MinIO/S3-compatible para desarrollo local? (S3 real solo en nube)
- Claves: Google OAuth client ID/secret, reCAPTCHA site/secret, bucket y credenciales AWS (solo cuando lleguemos a Fase 2/4).
