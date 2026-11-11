# LUMENZA

Red social de fotografía — «Cada mirada cuenta una historia».

Monorepo npm: `apps/api` (Express 5 + TypeScript + PostgreSQL), `apps/web` (React 19 + Vite + Tailwind 4).

## Desarrollo local
```bash
cp .env.example .env            # completar valores locales
docker compose up -d --wait db rustfs mailpit
npm ci && npm run migrate
npm run dev:api                 # http://localhost:4000
npm run dev:web                 # http://localhost:5173
```

## Verificación
`npm run typecheck` · `npm test` · `npm run test:integration -w @lumenza/api` · `npm run e2e -w @lumenza/web` · `npm run build`

## Despliegue
AWS EC2: `docs/DESPLIEGUE_AWS_EC2.md` y `deploy/aws/`. Las imágenes viven en S3 (RustFS en local); PostgreSQL guarda solo metadatos.

## Documentación
`PROGRESO.md` (estado), `DECISIONES_TECNICAS.md`, `docs/`. Integraciones externas pendientes de validar con credenciales reales: Google OAuth, reCAPTCHA, SMTP de producción.

## Seguridad
No se versionan secretos: use `.env` (ignorado) y los `*.example`.
