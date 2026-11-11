# Ubicaciones comunes. NOTA: add_header en un bloque `location` anula los heredados del servidor, por eso cada bloque
# que declara add_header incluye headers.inc.

location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
}

# API (Express). Los medios privados NO se cachean en Nginx.
location ^~ /api/ {
    limit_req zone=api_zone burst=40 nodelay;
    proxy_pass http://lumenza_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # sobrescribe: la API confía solo en este proxy (trust proxy = 1)
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
    proxy_request_buffering on;
    proxy_buffering on;
    proxy_hide_header X-Powered-By;
    proxy_hide_header Strict-Transport-Security;   # HSTS lo gestiona Nginx (evita cabeceras duplicadas)
}

# Endpoints de autenticación: límite adicional por IP en el borde (defensa en profundidad)
location ^~ /api/auth/ {
    limit_req zone=auth_zone burst=15 nodelay;
    limit_req_status 429;
    proxy_pass http://lumenza_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}

# Recursos con hash de contenido: caché larga
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    include /etc/nginx/lumenza/headers.inc;
    try_files $uri =404;
}

# Archivos estáticos sueltos (favicon, theme-init.js): caché corta
location ~* \.(svg|ico|js)$ {
    expires 1h;
    add_header Cache-Control "public";
    include /etc/nginx/lumenza/headers.inc;
    try_files $uri =404;
}

# SPA: cualquier ruta del frontend devuelve index.html (sin caché para recoger despliegues nuevos)
location / {
    add_header Cache-Control "no-cache";
    include /etc/nginx/lumenza/headers.inc;
    try_files $uri /index.html;
}
