#!/usr/bin/env bash
# LUMENZA — operación del despliegue en AWS EC2 (Ubuntu + Docker Compose).
# Uso:  ./lumenza.sh <comando> [argumentos]      (ver `./lumenza.sh help`)
# Ejecutar desde /opt/lumenza/deploy/aws. Nunca imprime secretos. No usa comandos destructivos (sin `down -v`, sin `prune`).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.aws.yml}"
PROJECT="${PROJECT:-}"                     # vacío = el nombre del propio compose (lumenza-aws)
BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
BASE_URL="${BASE_URL:-http://127.0.0.1}"   # Nginx local; en la EC2 es el puerto 80 del propio host

dc() { docker compose ${PROJECT:+-p "$PROJECT"} $COMPOSE_FILES --env-file "$ENV_FILE" "$@"; }
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
fail() { printf '  \033[31mFALLO\033[0m %s\n' "$*"; FAILED=1; }
warn() { printf '  \033[33mAVISO\033[0m %s\n' "$*"; }
FAILED=0
need_env() { [ -f "$ENV_FILE" ] || { echo "No existe $ENV_FILE. Ejecuta: ./lumenza.sh secrets" >&2; exit 1; }; }
envval() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

cmd_help() {
  cat <<'EOF'
Comandos:
  preflight           Comprueba el servidor (Docker, memoria, swap, disco, puertos, .env, metadatos IMDS)
  secrets             Crea .env desde .env.aws.example con secretos aleatorios (no sobrescribe un .env existente)
  config              Valida el Compose con tu .env (sin imprimir secretos)
  build               Construye las imágenes (api/worker y web)
  load <archivo.tar.gz>  Carga imágenes construidas en otra máquina (docker save)
  up                  Levanta todo (las migraciones se ejecutan antes de la API) y espera a que esté sano
  migrate             Ejecuta las migraciones manualmente (idempotente)
  health              Pruebas de salud completas (contenedores, Nginx, API, PostgreSQL, worker, no exposición de puertos)
  s3-check            Verifica el acceso a Amazon S3 con el rol IAM (escribe, lee y borra un objeto de prueba)
  status | logs [servicio] | stats | disk
  stop | start | restart [servicio] | down      (down NO borra volúmenes)
  backup              Respaldo de PostgreSQL (pg_dump -Fc) con rotación
  restore <archivo>   Restaura un respaldo (hace antes un respaldo de seguridad; pide confirmación)
  tls-issue           Emite el certificado Let's Encrypt (requiere dominio apuntando a la IP y TLS_MODE=off)
  tls-renew           Renueva el certificado y recarga Nginx
EOF
}

cmd_secrets() {
  [ -f "$ENV_FILE" ] && { echo "$ENV_FILE ya existe; no se sobrescribe."; return; }
  command -v openssl >/dev/null || { echo "Falta openssl"; exit 1; }
  umask 077
  cp .env.aws.example "$ENV_FILE"
  local pg sess mfa
  pg=$(openssl rand -hex 24); sess=$(openssl rand -base64 48 | tr -d '\n'); mfa=$(openssl rand -base64 32 | tr -d '\n')
  # '|' como delimitador: base64 puede contener '/'
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg|; s|^SESSION_SECRET=.*|SESSION_SECRET=$sess|; s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=$mfa|" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Creado $ENV_FILE (permisos 600) con secretos aleatorios. Edita ahora: PUBLIC_URL, S3_BUCKET (y SERVER_NAME/TLS_MODE si ya hay dominio)."
  echo "IMPORTANTE: respalda MFA_ENCRYPTION_KEY en un gestor de secretos; sin ella los secretos TOTP ya guardados no se pueden descifrar."
}

cmd_preflight() {
  say "Servidor"
  [ "$(uname -m)" = x86_64 ] && ok "Arquitectura x86_64" || warn "Arquitectura $(uname -m): las imágenes deben construirse para esa arquitectura"
  docker --version >/dev/null 2>&1 && ok "$(docker --version)" || fail "Docker no está instalado"
  docker compose version >/dev/null 2>&1 && ok "$(docker compose version --short 2>/dev/null | sed 's/^/Compose /')" || fail "Docker Compose no disponible"
  docker info >/dev/null 2>&1 && ok "El usuario puede usar Docker" || fail "No puedes usar Docker (¿falta 'sudo usermod -aG docker \$USER' y volver a entrar?)"
  local mem_mb swap_mb disk_gb
  mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo); swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
  disk_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  [ "$mem_mb" -ge 1700 ] && ok "RAM total ${mem_mb} MiB" || warn "RAM total ${mem_mb} MiB (se esperan ≈2 GiB)"
  [ "$swap_mb" -ge 1024 ] && ok "Swap ${swap_mb} MiB" || warn "Swap ${swap_mb} MiB: se recomienda un archivo de swap de 2 GiB (docs/DESPLIEGUE_AWS_EC2.md, paso 3)"
  [ "$disk_gb" -ge 8 ] && ok "Disco libre ${disk_gb} GiB" || fail "Disco libre ${disk_gb} GiB (mínimo recomendado 8)"
  for p in 80 443; do ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN && warn "El puerto $p ya está en uso" || ok "Puerto $p libre"; done
  say "Configuración"
  if [ -f "$ENV_FILE" ]; then
    ok "$ENV_FILE presente"
    [ "$(stat -c %a "$ENV_FILE")" = 600 ] && ok "Permisos 600" || warn "Permisos de $ENV_FILE distintos de 600 (chmod 600 $ENV_FILE)"
    for v in PUBLIC_URL POSTGRES_PASSWORD SESSION_SECRET MFA_ENCRYPTION_KEY S3_BUCKET S3_REGION; do
      val="$(envval $v)"; case "$val" in ''|CAMBIAR|REEMPLAZAR*|http://REEMPLAZAR) fail "$v sin definir";; *) ok "$v definido";; esac
    done
    [ "$(envval SESSION_SECRET)" != "$(envval MFA_ENCRYPTION_KEY)" ] && ok "SESSION_SECRET ≠ MFA_ENCRYPTION_KEY" || fail "SESSION_SECRET y MFA_ENCRYPTION_KEY deben ser distintos"
    grep -qE '^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|S3_ACCESS_KEY_ID|S3_SECRET_ACCESS_KEY)=.+' "$ENV_FILE" && fail "Hay claves AWS en el .env: usa SOLO el rol IAM" || ok "Sin claves AWS permanentes en el .env"
    [ "$(envval TLS_MODE)" = off ] && [ "$(envval COOKIE_SECURE)" = false ] && warn "Modo HTTP temporal (COOKIE_SECURE=false): válido solo para pruebas; el estado final exige HTTPS"
    [ "$(envval ALLOW_MISSING_INTEGRATIONS)" = true ] && warn "ALLOW_MISSING_INTEGRATIONS=true: sin correo ni reCAPTCHA reales (pendiente obligatorio antes de la entrega)"
  else fail "No existe $ENV_FILE (ejecuta ./lumenza.sh secrets)"; fi
  say "Metadatos de la instancia (IMDSv2) y rol IAM"
  local tok role
  tok=$(curl -fsS -m 3 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)
  if [ -n "$tok" ]; then
    role=$(curl -fsS -m 3 -H "X-aws-ec2-metadata-token: $tok" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null || true)
    [ -n "$role" ] && ok "Rol IAM adjunto: $role" || fail "La instancia no tiene un rol IAM adjunto"
    ok "Región: $(curl -fsS -m 3 -H "X-aws-ec2-metadata-token: $tok" http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null)"
  else warn "No se alcanza IMDS desde este host (¿no es una EC2?)"; fi
  [ "$FAILED" = 0 ] && say "Preflight correcto" || { say "Preflight con fallos"; exit 1; }
}

cmd_config() { need_env; dc config -q && echo "Compose válido"; }
cmd_build() { need_env; dc build; }
cmd_load() { [ -f "${1:-}" ] || { echo "Uso: ./lumenza.sh load imagenes.tar.gz"; exit 1; }; gunzip -c "$1" | docker load; }

cmd_up() {
  need_env
  dc up -d
  say "Esperando a que los servicios estén sanos (máx. 3 min)"
  for _ in $(seq 1 36); do
    unhealthy=$(dc ps --format '{{.Service}} {{.Health}} {{.State}}' | awk '$2!="healthy" && $1!="migrate" && $3!="exited"' | wc -l)
    [ "$unhealthy" = 0 ] && break; sleep 5
  done
  dc ps; cmd_health
}

cmd_migrate() { need_env; dc run --rm migrate; }

cmd_health() {
  need_env
  say "Contenedores"
  for s in db api worker web; do
    st=$(dc ps --format '{{.Service}} {{.Health}}' | awk -v s="$s" '$1==s {print $2}')
    [ "$st" = healthy ] && ok "$s healthy" || fail "$s: ${st:-no está en ejecución}"
  done
  mig=$(dc ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | awk '$1=="migrate"')
  case "$mig" in *"exited 0"*) ok "migrate terminó correctamente";; *) fail "migrate: ${mig:-sin ejecutar}";; esac
  say "HTTP (a través de Nginx, como lo ve un usuario)"
  curl -fsS -m 5 "$BASE_URL/healthz" >/dev/null && ok "Nginx /healthz" || fail "Nginx /healthz"
  curl -fsS -m 5 "$BASE_URL/" | grep -q '<div id="root">' && ok "Frontend (index.html)" || fail "Frontend no se sirve"
  curl -fsS -m 5 "$BASE_URL/api/health" | grep -q '"ok"' && ok "API /api/health" || fail "API /api/health"
  ready=$(curl -sS -m 10 "$BASE_URL/api/ready" || true)
  echo "$ready" | grep -q '"db":true' && ok "API → PostgreSQL" || fail "API → PostgreSQL ($ready)"
  echo "$ready" | grep -q '"storage":true' && ok "API → Amazon S3 (bucket accesible)" || fail "API → S3 ($ready)"
  curl -fsS -m 5 "$BASE_URL/api/auth/config" | grep -q 'recaptcha' && ok "Configuración pública de autenticación" || fail "/api/auth/config"
  [ "$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE_URL/api/feed")" = 401 ] && ok "Rutas privadas exigen sesión (401)" || fail "/api/feed no devolvió 401 sin sesión"
  say "Cabeceras de seguridad"
  h=$(curl -sI -m 5 "$BASE_URL/")
  for k in x-content-type-options x-frame-options content-security-policy referrer-policy; do echo "$h" | grep -qi "^$k:" && ok "$k" || fail "falta $k"; done
  say "Exposición de puertos (solo 80/443 públicos)"
  pub=$(dc ps --format '{{.Service}} {{.Ports}}' | grep -E '0\.0\.0\.0|\[::\]' | grep -v '^web ' || true)
  [ -z "$pub" ] && ok "Solo Nginx publica puertos; PostgreSQL y API no están expuestos" || fail "Servicios con puertos publicados: $pub"
  say "Recursos"
  dc ps -q | xargs -r docker stats --no-stream --format '  {{.Name}}  CPU {{.CPUPerc}}  MEM {{.MemUsage}} ({{.MemPerc}})'
  command -v free >/dev/null && free -m | awk 'NR==1 || /Mem|Swap/' || true
  [ "$FAILED" = 0 ] && say "Todas las pruebas de salud pasaron" || { say "Hay pruebas fallidas"; exit 1; }
}

cmd_s3_check() {
  need_env
  say "1) Metadatos del rol IAM desde DENTRO de un contenedor (IMDSv2: requiere hop limit ≥ 2)"
  dc run --rm --no-deps --entrypoint node -T api -e "
    fetch('http://169.254.169.254/latest/api/token',{method:'PUT',headers:{'X-aws-ec2-metadata-token-ttl-seconds':'60'},signal:AbortSignal.timeout(4000)})
      .then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()})
      .then(()=>{console.log('  OK   El contenedor alcanza IMDSv2');})
      .catch(e=>{console.error('  FALLO El contenedor NO alcanza IMDSv2 ('+e.message+'). Ejecuta en tu equipo con AWS CLI: aws ec2 modify-instance-metadata-options --instance-id <ID> --http-put-response-hop-limit 2 --http-tokens required --region us-east-2');process.exit(1)})"
  say "2) Escritura / lectura / borrado en el bucket $(envval S3_BUCKET) con el rol (objeto healthcheck/persist.txt)"
  dc run --rm --no-deps -T api node dist/storage/cli.js put
  dc run --rm --no-deps -T api node dist/storage/cli.js get
  echo "  OK   Amazon S3 accesible con el rol IAM (put/get/delete)"
}

cmd_backup() {
  need_env
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  local f="$BACKUP_DIR/lumenza-$(date +%Y%m%d-%H%M%S).dump"
  dc exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "$f"
  chmod 600 "$f"
  # Verificación: el archivo debe ser legible por pg_restore y no estar vacío
  dc exec -T db pg_restore --list < "$f" >/dev/null && echo "Respaldo verificado: $f ($(du -h "$f" | cut -f1))" || { echo "Respaldo CORRUPTO: $f" >&2; rm -f "$f"; exit 1; }
  ls -1t "$BACKUP_DIR"/lumenza-*.dump 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
  echo "Respaldos conservados: $(ls -1 "$BACKUP_DIR"/lumenza-*.dump | wc -l) (máx. $KEEP_BACKUPS)."
  echo "Recuerda copiarlo fuera de la instancia (p. ej. scp a tu equipo). Las fotografías ya están en S3."
}

# Recrea la base de datos y restaura el respaldo sobre una base VACÍA (no usa --clean: falla con las tablas particionadas de pg-boss).
do_restore() {
  dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$POSTGRES_DB\""' >/dev/null
  dc exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$1"
}

cmd_restore() {
  need_env
  local f="${1:-}"; [ -f "$f" ] || { echo "Uso: ./lumenza.sh restore /ruta/respaldo.dump" >&2; exit 1; }
  dc exec -T db pg_restore --list < "$f" >/dev/null || { echo "El archivo no es un respaldo válido" >&2; exit 1; }
  echo "Se REEMPLAZARÁ el contenido actual de la base de datos por: $f"
  if [ "${ASSUME_YES:-}" != 1 ]; then read -r -p "Escribe RESTAURAR para continuar: " a; [ "$a" = RESTAURAR ] || { echo "Cancelado."; exit 1; }; fi
  say "Respaldo de seguridad previo"; cmd_backup
  local safety; safety="$(ls -1t "$BACKUP_DIR"/lumenza-*.dump | head -1)"
  say "Deteniendo web, api y worker"; dc stop web api worker
  say "Restaurando $f"
  if do_restore "$f"; then
    say "Reiniciando"; dc up -d
    echo "Restauración completada. Ejecuta ./lumenza.sh health"
  else
    echo "LA RESTAURACIÓN FALLÓ. Intentando volver al estado anterior ($safety)…" >&2
    if do_restore "$safety"; then dc up -d; echo "Se recuperó el estado anterior. Revisa el archivo de respaldo elegido." >&2
    else echo "No se pudo volver atrás automáticamente. Respaldo previo: $safety. Restáuralo con: ASSUME_YES=1 ./lumenza.sh restore $safety" >&2; fi
    exit 1
  fi
}

cmd_tls_issue() {
  need_env
  local d; d="$(envval SERVER_NAME)"; [ -n "$d" ] && [ "$d" != "_" ] || { echo "Define SERVER_NAME con tu dominio en $ENV_FILE" >&2; exit 1; }
  [ "$(envval TLS_MODE)" = off ] || { echo "Para emitir el certificado deja TLS_MODE=off, emítelo y luego cambia a on" >&2; exit 1; }
  read -r -p "Correo para avisos de Let's Encrypt: " mail
  dc --profile tls run --rm certbot certonly --webroot -w /var/www/certbot -d "$d" --email "$mail" --agree-tos --no-eff-email
  echo "Certificado emitido. Ahora edita $ENV_FILE: TLS_MODE=on, PUBLIC_URL=https://$d, COOKIE_SECURE=true y ejecuta ./lumenza.sh up (recrea los servicios cuyo entorno cambió; 'restart' NO relee el .env)"
}
cmd_tls_renew() { need_env; dc --profile tls run --rm certbot renew --webroot -w /var/www/certbot && dc exec web nginx -s reload; }

sub="${1:-help}"; shift || true
case "$sub" in
  help|-h|--help) cmd_help ;;
  preflight) cmd_preflight ;;
  secrets) cmd_secrets ;;
  config) cmd_config ;;
  build) cmd_build ;;
  load) cmd_load "$@" ;;
  up) cmd_up ;;
  migrate) cmd_migrate ;;
  health) cmd_health ;;
  s3-check) cmd_s3_check ;;
  status) need_env; dc ps ;;
  logs) need_env; dc logs --tail=100 -f "$@" ;;
  stats) need_env; dc ps -q | xargs -r docker stats --no-stream; free -m ;;
  disk) need_env; docker system df; df -h /; docker volume ls --format '{{.Name}}' | grep -E 'lumenza' | xargs -r -I{} sh -c 'echo "volumen {}: $(docker run --rm -v {}:/v alpine du -sh /v 2>/dev/null | cut -f1)"' ;;
  stop) need_env; dc stop ;;
  start) need_env; dc start ;;
  restart) need_env; dc restart "$@" ;;
  down) need_env; dc down ;;
  backup) cmd_backup ;;
  restore) cmd_restore "$@" ;;
  tls-issue) cmd_tls_issue ;;
  tls-renew) cmd_tls_renew ;;
  *) echo "Comando desconocido: $sub"; cmd_help; exit 1 ;;
esac
