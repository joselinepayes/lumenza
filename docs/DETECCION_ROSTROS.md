# Detección de rostros (Fase 5)

## Qué hace y qué NO hace
- **Hace**: localizar rostros en las fotografías publicadas, mostrar cuántos hay y dibujar recuadros precisos sobre ellos (activables/desactivables) dentro de LUMENZA Studio.
- **No hace**: identificar ni reconocer personas, comparar rostros, inferir edad, género, etnia, emociones u otros atributos, almacenar plantillas/descriptores/landmarks ni recortes de rostros. **No usa la cámara del dispositivo**: solo analiza fotografías que el usuario sube; por eso no hay permiso de cámara que solicitar (si en el futuro se añadiera captura con cámara, requerirá consentimiento explícito del navegador y del usuario).

## Tecnología seleccionada
| Opción evaluada | Decisión |
|---|---|
| **`@vladmandic/face-api` 1.7.15 (MIT)** — fork mantenido de face-api.js, TensorFlow.js con backend **WASM**, red **SSD MobileNet v1** | **Elegida.** Es face-api.js (requisito académico), sin compilación nativa (funciona igual en Windows, Linux y Docker), modelos incluidos en el paquete (sin descargas), se ejecuta en el worker. |
| `face-api.js` original (0.22.2, sin mantenimiento desde 2022) | Descartada: abandonada y exige `tfjs-node` nativo. |
| OpenCV (`opencv4nodejs`/Haar) | Descartada: compilación nativa frágil; menor precisión que SSD. |
| ONNX Runtime + YuNet/SCRFD | Alternativa viable; requiere descargar/versionar el modelo y escribir el post-procesado. |
Solo se carga **la red de detección** (no se cargan landmarks, reconocimiento, edad/género ni expresiones). Parámetros: confianza mínima 0,5; máx. 50 rostros; raster de detección ≤ 1024 px; recuadros ordenados de izquierda a derecha.

## Arquitectura
`worker → processPhoto → (variantes) → analyzeFaces(raster ya orientado) → photos.faces (JSONB)` + `faces_status` (`pending|done|failed`) + `faces_model`.
- Funciona sobre la imagen guardada en el almacenamiento (RustFS hoy, Amazon S3 después): el worker lee el original por `StorageService`; no depende del proveedor.
- Las coordenadas se guardan **normalizadas (0–1) sobre la imagen ya orientada**, por lo que sirven para cualquier tamaño y para todas las versiones (original, B/N, sepia, tono LUMENZA).
- **Degradación**: si el detector falla, la fotografía queda `ready` y `faces_status=failed`; el autor puede repetir (`POST /api/posts/:id/faces/reanalyze`) sin que cambie su estado visible.
- **Fotografías anteriores**: el barrido del worker analiza las que quedaron `pending` sin reprocesar variantes.
- **Privacidad**: el DTO de la publicación incluye los recuadros con la **misma visibilidad que la foto** (privada → solo autor; seguidores → seguidores). Lo único almacenado por rostro es `{x, y, w, h, score}`; al eliminar la publicación se eliminan con ella. No se crean objetos adicionales en S3 (comprobado por prueba: sigue habiendo 6 objetos por foto).

## Interfaz
Botón «Rostros N» (con `aria-pressed`) en la cabecera de Studio, recuadros con doble trazo (legibles sobre fotos claras y oscuras) numerados, resumen accesible («2 rostros detectados», `aria-live`), aviso «solo localización» y aviso en el modal de publicar. La preferencia mostrar/ocultar se guarda solo en el navegador del visitante. Funciona con selector de versiones, comparador y pantalla completa.

## Limitaciones del detector
- Es un detector SSD ligero: pierde rostros **muy pequeños** (< ~3 % del ancho), muy ocluidos, de perfil extremo, rotados fuertemente, en penumbra o con baja resolución; puede dar falsos positivos en patrones con forma de rostro (estatuas, ilustraciones).
- Los recuadros son aproximados (no segmentan el rostro); su ajuste depende de la pose.
- Rendimiento: ≈ 0,8 s por imagen en CPU/WASM (primer uso añade la carga del modelo ≈ 0,1 s); no usa GPU.
- La precisión puede variar entre grupos demográficos y condiciones de iluminación; por eso el resultado se presenta como **ayuda visual** y nunca se usa para decisiones sobre personas.
- Pruebas con retratos de dominio público (`apps/api/test-fixtures`, NASA) y composiciones; no hay una evaluación estadística de precisión/recall con un conjunto de datos anotado.

## Pruebas
`apps/api/src/faces/faces.integration.test.ts` (7, detector real) y `apps/web/e2e/faces.spec.ts` (8). Ver `PROGRESO.md` para resultados.
