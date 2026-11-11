# Imagen del API y del worker de procesamiento (mismo código; cambia el comando).
# Contexto de construcción: raíz del monorepo.  docker build -f apps/api/Dockerfile -t lumenza-api .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @lumenza/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w @lumenza/api && npm prune --omit=dev --workspace @lumenza/api

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY db db
USER node
WORKDIR /app/apps/api
CMD ["node", "dist/server.js"]
