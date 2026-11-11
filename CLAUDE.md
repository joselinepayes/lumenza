# CLAUDE.md — reglas de trabajo en LUMENZA

Red social de fotografía («Cada mirada cuenta una historia»). Monorepo npm: `apps/api` (Express 5 + TS + PostgreSQL), `apps/web` (React 19 + Vite + Tailwind 4).

## Reglas
- Trabajar por fases pequeñas y verificables; no declarar una fase completa con errores críticos ni sin verificar.
- Nunca inventar resultados de pruebas ni simular integraciones (Google, reCAPTCHA, SMTP real, S3 real): si faltan credenciales, dejarlo preparado y documentado como **pendiente**.
- Sin secretos en el repositorio: `.env` (ignorado) y `.env.example`.
- Imágenes jamás en PostgreSQL: solo `bucket` + `storage_key` + metadatos. Acceso vía `StorageService` (S3: RustFS local, Amazon S3 en producción).
- Arquitectura backend: routes → controllers/services → repositories → pg. Validación con Zod. Autorización por recurso.
- Diseño: tokens en `apps/web/src/styles/tokens.css`, claro/oscuro, Fraunces + Inter, Lucide, sin emojis; responsive desde 320 px; `prefers-reduced-motion`.
- No tocar los contenedores `cloudstore-*`; no usar `docker compose down -v` ni `docker system prune`; sin recursos facturables.
- Git Bash en Windows: `MSYS_NO_PATHCONV=1` para rutas tipo `/data` en docker.

## Comandos
- Infra local: `docker compose up -d --wait db rustfs mailpit` · `npm run migrate`
- Dev: `npm run dev:api` (4000) y `npm run dev:web` (5173)
- Verificación: `npm run typecheck` · `npm test` · `npm run test:integration -w @lumenza/api` · `npm run e2e -w @lumenza/web` · `npm run build`

## Despliegue AWS EC2
Runbook: `docs/DESPLIEGUE_AWS_EC2.md`. Operación: `deploy/aws/lumenza.sh` (preflight, secrets, build, up, health, s3-check, backup, restore, tls-issue…). Empaquetar: `bash deploy/aws/pack-for-ec2.sh`. No incluir `.env` ni claves AWS (se usa el rol IAM). Escribir archivos con LF (no CRLF).

## Continuidad
Estado en `PROGRESO.md`, decisiones en `DECISIONES_TECNICAS.md`, análisis en `docs/FASE_0_ANALISIS.md`, integraciones externas en `docs/CONFIGURACION_INTEGRACIONES.md`.
Pendientes obligatorios antes de la entrega: validar Google OAuth y reCAPTCHA con credenciales reales; SMTP de producción; despliegue AKS/AWS.
