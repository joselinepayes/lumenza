#!/bin/sh
# Selecciona la plantilla de Nginx según TLS_MODE (off|on) ANTES de que la imagen oficial ejecute envsubst.
set -eu
mode="${TLS_MODE:-off}"
mkdir -p /etc/nginx/templates
case "$mode" in
  on)  echo 'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' > /etc/nginx/lumenza/hsts.inc
       cp /etc/nginx/lumenza-templates/https.conf.template /etc/nginx/templates/default.conf.template
       cert="/etc/letsencrypt/live/${SERVER_NAME:?SERVER_NAME requerido en TLS_MODE=on}/fullchain.pem"
       [ -f "$cert" ] || { echo "ERROR: TLS_MODE=on pero no existe $cert. Emita el certificado primero (docs/DESPLIEGUE_AWS_EC2.md)." >&2; exit 1; } ;;
  off) echo '# HSTS solo en modo HTTPS' > /etc/nginx/lumenza/hsts.inc
       cp /etc/nginx/lumenza-templates/http.conf.template /etc/nginx/templates/default.conf.template ;;
  *)   echo "TLS_MODE debe ser 'on' u 'off'" >&2; exit 1 ;;
esac
echo "LUMENZA nginx: TLS_MODE=$mode SERVER_NAME=${SERVER_NAME:-_}"
