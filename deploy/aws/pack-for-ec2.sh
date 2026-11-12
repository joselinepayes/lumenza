#!/usr/bin/env bash
# Empaqueta LUMENZA para transferirlo a la EC2 (ejecutar en TU equipo, desde la raíz del repositorio, con Git Bash/WSL/Linux/macOS).
# Resultado: ./lumenza-deploy.tar.gz  (+ lumenza-deploy.sha256 para verificar la integridad tras copiarlo). Mismo formato de siempre.
#
# Uso:  bash deploy/aws/pack-for-ec2.sh            crea el paquete
#       bash deploy/aws/pack-for-ec2.sh --check    solo construye y valida la lista de archivos (no escribe ningún paquete)
#
# Diseño (seguro por defecto, falla cerrado):
#  1. Se parte de una LISTA BLANCA de raíces (las mismas de siempre) y se recorre el disco con `find`, no con el índice de Git:
#     lo que está ignorado por Git también podría colarse, así que se filtra por nombre en CUALQUIER profundidad.
#  2. Se descartan carpetas (node_modules, .git, dist, respaldos, claves, …) y archivos sensibles (.env reales y variantes,
#     claves/certificados, volcados, respaldos, TAR anteriores, temporales). Solo se conservan los .env de ejemplo legítimos.
#  3. Se aborta si hay enlaces simbólicos, archivos especiales o archivos de tamaño anómalo dentro de las raíces.
#  4. Se buscan patrones de credenciales en el CONTENIDO de lo que sí entra (se imprimen solo nombres de archivo, nunca valores).
#  5. Tras crear el paquete se vuelve a comprobar su contenido (rutas, enlaces, nombres sensibles, raíces permitidas). Si algo
#     falla se borra el paquete y se sale con código 1.
# No lee ni imprime el contenido de archivos .env, no borra nada del proyecto y solo escribe lumenza-deploy.{tar.gz,sha256}.
set -euo pipefail
export LC_ALL=C

CHECK_ONLY=0
case "${1:-}" in
  '') ;;
  --check) CHECK_ONLY=1 ;;
  *) echo "Uso: bash deploy/aws/pack-for-ec2.sh [--check]" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$(dirname "${BASH_SOURCE[0]}")")")"
[ -f deploy/aws/docker-compose.aws.yml ] || { echo "Ejecuta desde la raíz del repositorio LUMENZA" >&2; exit 1; }

OUT=lumenza-deploy.tar.gz
SHA=lumenza-deploy.sha256
LIST="$(mktemp)"
OK=0
cleanup() {
  rm -f "$LIST"
  if [ "$OK" -ne 1 ]; then rm -f "$OUT" "$SHA"; fi # cualquier fallo deja el directorio sin paquete a medias
}
trap cleanup EXIT
die() { echo "ERROR: $*" >&2; exit 1; }

# Raíces permitidas (lista blanca): exactamente lo que ya se empaquetaba.
ROOTS=(package.json package-lock.json .dockerignore .env.example CLAUDE.md PROGRESO.md DECISIONES_TECNICAS.md apps db deploy docs docker-compose.yml)
for r in "${ROOTS[@]}"; do [ -e "$r" ] || die "falta $r en la raíz del repositorio"; done

# Carpetas que nunca entran, a cualquier profundidad.
PRUNE_DIRS=(node_modules .git dist test-results playwright-report preview-out backups .aws .ssh .gnupg .claude .vscode .idea coverage test-fixtures credentials secrets)
PRUNE_EXPR=(\()
for d in "${PRUNE_DIRS[@]}"; do
  [ "${#PRUNE_EXPR[@]}" -gt 1 ] && PRUNE_EXPR+=(-o)
  PRUNE_EXPR+=(-name "$d")
done
PRUNE_EXPR+=(\))

# ¿El nombre del archivo es sensible? (sin distinguir mayúsculas). Los únicos .env permitidos son los dos ejemplos.
sensitive_name() {
  local b
  b="$(basename -- "$1" | tr 'A-Z' 'a-z')"
  case "$b" in
    .env.example | .env.aws.example) return 1 ;;
    .env | .env.* | *.env | .envrc) return 0 ;;
    *.pem | *.key | *.p12 | *.pfx | *.crt | *.cer | *.der | *.jks | *.keystore | *.p8 | *.ppk | *.gpg | *.pgp) return 0 ;;
    id_rsa* | id_dsa* | id_ecdsa* | id_ed25519* | *_rsa | *_dsa | *_ecdsa | *_ed25519 | known_hosts | authorized_keys) return 0 ;;
    *.dump | *.bak | *.backup | *.old | *.sql.gz | *.sql.zip | *.tar | *.tar.gz | *.tgz | *.zip | *.7z | *.rar | *.sha256 | lumenza-deploy.*) return 0 ;;
    *.log | *.tmp | *.temp | *.swp | *.swo | *~ | *.orig | *.rej | .ds_store | thumbs.db) return 0 ;;
    .npmrc | .netrc | .pgpass | .htpasswd | .git-credentials | *.secret | *.secrets) return 0 ;;
    # Solo formatos de DATOS: nunca «credentials.*» ni «secrets.*» a secas (credentials.service.ts es código fuente legítimo).
    credentials | credentials.json | credentials.csv | credentials.txt | credentials.ini | credentials.yml | credentials.yaml | credentials.xml) return 0 ;;
    secrets.json | secrets.csv | secrets.txt | secrets.ini | secrets.yml | secrets.yaml | secrets.toml | secrets.env) return 0 ;;
    terraform.tfstate | terraform.tfstate.* | *.tfvars | *.tfstate) return 0 ;;
  esac
  return 1
}

# 1) Enlaces simbólicos, archivos especiales y tamaños anómalos dentro de las raíces (fuera de las carpetas descartadas).
LINKS="$(find "${ROOTS[@]}" -type d "${PRUNE_EXPR[@]}" -prune -o -type l -print)"
[ -z "$LINKS" ] || { printf 'ERROR: hay enlaces simbólicos (podrían apuntar fuera del proyecto):\n%s\n' "$LINKS" >&2; exit 1; }
SPECIAL="$(find "${ROOTS[@]}" -type d "${PRUNE_EXPR[@]}" -prune -o ! -type f ! -type d ! -type l -print)"
[ -z "$SPECIAL" ] || { printf 'ERROR: hay archivos especiales (socket/tubería/dispositivo):\n%s\n' "$SPECIAL" >&2; exit 1; }
BIG="$(find "${ROOTS[@]}" -type d "${PRUNE_EXPR[@]}" -prune -o -type f -size +50M -print)"
[ -z "$BIG" ] || { printf 'ERROR: archivos de más de 50 MB (¿un artefacto o respaldo?):\n%s\n' "$BIG" >&2; exit 1; }

# 2) Lista de archivos permitidos. El orden de find se conserva; las carpetas se archivan sin recursión (--no-recursion).
EXCLUDED=()
N=0
while IFS= read -r -d '' p; do
  if [ ! -d "$p" ] && sensitive_name "$p"; then EXCLUDED+=("$p"); continue; fi
  printf '%s\0' "$p" >> "$LIST"
  N=$((N + 1))
done < <(find "${ROOTS[@]}" -type d "${PRUNE_EXPR[@]}" -prune -o -print0)
[ "$N" -gt 0 ] || die "la lista de archivos quedó vacía"

# 3) Búsqueda de credenciales en el contenido de los archivos que sí entran (solo se imprimen NOMBRES de archivo).
#    Los patrones están escritos de forma que este mismo script no los contiene literalmente.
HITS="$(
  tr '\0' '\n' < "$LIST" | while IFS= read -r f; do [ -f "$f" ] && printf '%s\0' "$f"; done |
    xargs -0 grep -lIE -e '-----BEGIN [A-Z ]*PRIV[A]TE KEY-----' -e '\bA[KS]IA[0-9A-Z]{16}\b' -e 'aws_secret_access_key[[:space:]]*[=:][[:space:]]*[A-Za-z0-9/+]{30,}' \
      -e '\bgh[pousr]_[A-Za-z0-9]{36,}\b' -e '\bxox[baprs]-[A-Za-z0-9-]{10,}\b' -e '\bAIza[0-9A-Za-z_-]{35}\b' -- 2> /dev/null || true
)"
[ -z "$HITS" ] || { printf 'ERROR: posibles credenciales en el contenido de estos archivos (revíselos; no se muestra el valor):\n%s\n' "$HITS" >&2; exit 1; }

if [ "$CHECK_ONLY" -eq 1 ]; then
  OK=1
  echo "Comprobación correcta: $N entradas se empaquetarían; ${#EXCLUDED[@]} archivos sensibles quedarían fuera."
  for e in "${EXCLUDED[@]:0:30}"; do echo "  excluido: $e"; done
  [ "${#EXCLUDED[@]}" -le 30 ] || echo "  … y $((${#EXCLUDED[@]} - 30)) más"
  exit 0
fi

# 4) Empaquetado (mismo formato: gzip, rutas relativas sin «./», mismas raíces).
tar --no-recursion --null -T "$LIST" -czf "$OUT"

# 5) Validación final del paquete ya creado: rutas, enlaces, raíces permitidas y nombres sensibles. Falla cerrado.
TMPL="$(mktemp)"
trap 'rm -f "$TMPL"; cleanup' EXIT
tar -tzf "$OUT" > "$TMPL"
[ -s "$TMPL" ] || die "el paquete está vacío"
if grep -qE '(^/|(^|/)\.\.(/|$)|\\)' "$TMPL"; then die "el paquete contiene rutas absolutas o con «..»"; fi
if tar -tvzf "$OUT" | grep -qE '^[lh]'; then die "el paquete contiene enlaces simbólicos o duros"; fi
ROOTS_RE='^(package\.json|package-lock\.json|\.dockerignore|\.env\.example|CLAUDE\.md|PROGRESO\.md|DECISIONES_TECNICAS\.md|docker-compose\.yml|apps|db|deploy|docs)(/|$)'
OUTSIDE="$(grep -vE "$ROOTS_RE" "$TMPL" || true)"
[ -z "$OUTSIDE" ] || { printf 'ERROR: entradas fuera de las raíces permitidas:\n%s\n' "$OUTSIDE" >&2; exit 1; }
BADDIR="$(grep -E "(^|/)($(IFS='|'; echo "${PRUNE_DIRS[*]}" | sed 's/\./\\./g'))(/|$)" "$TMPL" || true)"
[ -z "$BADDIR" ] || { printf 'ERROR: el paquete contiene carpetas que deben excluirse:\n%s\n' "$BADDIR" >&2; exit 1; }
BADNAMES=""
while IFS= read -r e; do
  case "$e" in */) continue ;; esac
  if sensitive_name "$e"; then BADNAMES="$BADNAMES$e"$'\n'; fi
done < "$TMPL"
[ -z "$BADNAMES" ] || { printf 'ERROR: el paquete contiene archivos sensibles:\n%s' "$BADNAMES" >&2; exit 1; }

sha256sum "$OUT" > "$SHA"
OK=1
echo "Creado $OUT ($(du -h "$OUT" | cut -f1)) con $(wc -l < "$TMPL") entradas; ${#EXCLUDED[@]} archivos sensibles excluidos. SHA-256 en $SHA"
