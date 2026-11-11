#!/usr/bin/env bash
# Empaqueta LUMENZA para transferirlo a la EC2 (ejecutar en TU equipo, desde la raíz del repositorio, con Git Bash/WSL/Linux/macOS).
# Excluye: secretos (.env*), dependencias, compilados, resultados de pruebas, respaldos y metadatos de git.
# Resultado: ./lumenza-deploy.tar.gz  (+ lumenza-deploy.sha256 para verificar la integridad tras copiarlo)
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")"
[ -f deploy/aws/docker-compose.aws.yml ] || { echo "Ejecuta desde la raíz del repositorio LUMENZA" >&2; exit 1; }

OUT=lumenza-deploy.tar.gz
tar --exclude='./node_modules' --exclude='*/node_modules' \
    --exclude='./.git' --exclude='*/dist' \
    --exclude='.env' --exclude='.env.localtest' --exclude='.env.local' --exclude='.env.production' --exclude='*.pem' --exclude='*.key' --exclude='*.dump' \
    --exclude='apps/api/test-fixtures' \
    --exclude='apps/web/test-results' --exclude='apps/web/playwright-report' --exclude='apps/api/preview-out' \
    --exclude='deploy/aws/backups' --exclude='*.log' --exclude="./$OUT" \
    -czf "$OUT" \
    package.json package-lock.json .dockerignore .env.example CLAUDE.md PROGRESO.md DECISIONES_TECNICAS.md \
    apps db deploy docs docker-compose.yml

# Comprobación de seguridad: el paquete no debe contener secretos
if tar -tzf "$OUT" | grep -E '(^|/)\.env($|\.)' | grep -vE '\.env(\.aws)?\.example$' ; then
  echo "ERROR: el paquete contiene archivos .env" >&2; rm -f "$OUT"; exit 1
fi
if tar -tzf "$OUT" | grep -E '\.(pem|key|dump)$'; then echo "ERROR: el paquete contiene claves o respaldos" >&2; rm -f "$OUT"; exit 1; fi

sha256sum "$OUT" > lumenza-deploy.sha256
echo "Creado $OUT ($(du -h "$OUT" | cut -f1)) con $(tar -tzf "$OUT" | wc -l) entradas. SHA-256 en lumenza-deploy.sha256"
