# Procesamiento de fotografías (Fase 4) — arquitectura

## Flujo
```
Navegador ──POST /api/posts──► API (Express)
                                │ 1. valida cabecera con sharp (formato real, ≤60 MP, ≥200 px, ≤15 MB)
                                │ 2. guarda el original en S3        ── RustFS (local) / Amazon S3 (producción)
                                │ 3. INSERT posts + photos (status = pending) en PostgreSQL
                                │ 4. encola { photoId } en pg-boss   ── cola en PostgreSQL (sin Redis)
                                └─► 202 Accepted (la petición no espera al procesamiento)

Worker (apps/api/src/worker.ts; proceso independiente o contenedor)
   consume la cola → processPhoto():
     a) saneado del original: decodificación completa, auto-orientación, re-codificación SIN EXIF/GPS (sobrescribe la clave original)
     b) UNA decodificación a un raster de trabajo ≤ 2400 px (límite de memoria)
     c) variantes: display 1440 · thumbnail 640 · bw_editorial · sepia_cinema · lumen_tone (≤ 1800 px, WebP q86)
        cada una: put en S3 → upsert en photo_variants (+ params de la receta) → progreso 30/42/60/78/95 %
     d) status = ready, progress = 100, processed_by = id del worker

Frontend: consulta el estado cada 1,2 s mientras status ∈ {pending, processing} y parchea feed/perfil/detalle sin recargar.
```

## Decisión de cola
| Opción | Veredicto |
|---|---|
| **pg-boss (PostgreSQL)** | **Elegida.** Reutiliza la BD existente (cero servicios nuevos), reintentos con backoff, expiración de trabajos activos (recuperación ante caída), política `exclusive` + `singletonKey` = encolado idempotente. Suficiente para el volumen del proyecto. |
| BullMQ + Redis | Descartada: añade un servicio (Redis) que operar, desplegar y respaldar sin ventaja para este volumen. |
| Procesar en la petición | Descartada: bloquea la API y no tolera reinicios. |

El worker comparte código con la API; en Docker usa la misma imagen (`apps/api/Dockerfile`) con `CMD node dist/worker.js` (servicio `worker`, perfil `worker` de Compose).

## Estados y fallos
`pending → processing → ready | partial | failed`
- **Reintentos**: 3 con backoff exponencial (pg-boss). El pipeline es **idempotente**: las variantes ya generadas no se rehacen.
- **Error permanente** (imagen dañada/ilegible): `failed` inmediato, sin gastar reintentos.
- **Reintentos agotados**: `partial` si existen display y miniatura (la imagen es utilizable), si no `failed`. El autor puede pulsar «Reintentar» (`POST /api/posts/:id/reprocess`).
- **Caída del worker**: el trabajo activo expira (300 s) y pg-boss lo reentrega; además un barrido cada 60 s re-encola fotografías atascadas y las de la Fase 3 sin transformaciones.
- **Eliminación durante el proceso**: la API borra las claves deterministas (`photos/{autor}/{post}/…`) y el worker, al detectar que la fila ya no existe, borra lo que haya escrito y termina limpio.

## Recetas Sharp (archivos reales, no CSS)
| Variante | Receta |
|---|---|
| `bw_editorial` | luminancia Rec. 601 (`recomb`) · `normalise` 1–99 % · contraste ×1,10 / −11 · gamma 1,06 · nitidez ligera · viñeta 0,28 |
| `sepia_cinema` | saturación 0,2 · `tint` #C48C5C (preserva luminancia) · luces ×0,94 / negros +12 · gamma 1,08 · viñeta 0,42 |
| `lumen_tone` | brillo 1,02 · saturación 1,06 · balance por canal ×[1,03 0,99 1,08] +[4 0 14] · resplandor `soft-light` lila→violeta→grafito · nitidez ligera |
Los parámetros usados se guardan en `photo_variants.params` (JSONB) y se muestran en LUMENZA Studio.
El original nunca recibe filtros: solo se sanea (orientación y metadatos).

## Límites y seguridad
- Petición: 15 MB, formato por contenido (JPEG/PNG/WebP), ≤ 60 MP, ≥ 200 px; SVG/GIF/animadas rechazadas.
- Worker: `sharp.cache(128 MB)`, `sharp.concurrency(2)`, raster de trabajo ≤ 2400 px, `limitInputPixels`, concurrencia configurable (`WORKER_CONCURRENCY`), `mem_limit: 1g` en Compose.
- Acceso: bucket privado; los archivos se sirven por `/api/media/photo/:id/:variante` con control de visibilidad (privada/seguidores). El **original** (y `?download=1`) solo para el autor o si permitió descargas; mientras el original no está saneado no se sirve.

## Operación
```bash
docker compose up -d --wait db rustfs mailpit && npm run migrate
npm run dev:worker -w @lumenza/api                      # worker local con recarga
docker compose --profile worker up -d --build worker    # worker en contenedor
npm run preview:transforms -w @lumenza/api -- [imagen]  # hoja de contacto para revisar las recetas
```
