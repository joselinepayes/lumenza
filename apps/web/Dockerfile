# Frontend de LUMENZA: compila React/Vite y lo sirve con Nginx (también reenvía /api al contenedor `api`).
# Contexto de construcción: raíz del monorepo.  docker build -f apps/web/Dockerfile -t lumenza-web .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @lumenza/web --include-workspace-root
COPY apps/web apps/web
# Bajo en memoria: tsc + vite (≈ 600 MB). Si se construye en una EC2 de 2 GiB, añadir swap (ver docs/DESPLIEGUE_AWS_EC2.md)
ENV NODE_OPTIONS=--max-old-space-size=900
RUN npm run build -w @lumenza/web

FROM nginx:1.28-alpine
RUN apk add --no-cache wget dos2unix \
 && rm -f /etc/nginx/conf.d/default.conf \
 && mkdir -p /etc/nginx/lumenza /etc/nginx/lumenza-templates /var/www/certbot
COPY apps/web/nginx/common.inc apps/web/nginx/locations.inc apps/web/nginx/headers.inc /etc/nginx/lumenza/
COPY apps/web/nginx/http.conf.template apps/web/nginx/https.conf.template /etc/nginx/lumenza-templates/
COPY apps/web/nginx/05-select-config.sh /docker-entrypoint.d/05-select-config.sh
# Defensa: si el repositorio se extrajo con finales de línea Windows (CRLF), el script de arranque fallaría en Linux.
RUN dos2unix -q /docker-entrypoint.d/05-select-config.sh /etc/nginx/lumenza/*.inc /etc/nginx/lumenza-templates/* \
 && chmod +x /docker-entrypoint.d/05-select-config.sh
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
ENV TLS_MODE=off SERVER_NAME=_
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
