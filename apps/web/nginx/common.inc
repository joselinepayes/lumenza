# Parámetros comunes a los dos modos (HTTP/HTTPS)
root /usr/share/nginx/html;
index index.html;
server_tokens off;
client_max_body_size 16m;          # subidas de hasta 15 MB (+ cabeceras multipart)
client_body_timeout 30s;
send_timeout 60s;

gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;

# Cabeceras de seguridad (la API añade las suyas con Helmet)
include /etc/nginx/lumenza/headers.inc;
