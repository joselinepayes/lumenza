# Ubicaciones comunes. NOTA: add_header en un bloque `location` anula los heredados del servidor, por eso cada bloque
# que declara add_header incluye headers.inc.

location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 "ok\n";
}

# Flujo SSE de avisos en tiempo real (GET /api/events). Ruta EXACTA, más específica que /api/: misma lógica de proxy y mismo
# límite de peticiones; se añade lo propio de un flujo largo y se hace explícito en Nginx lo que la API ya pide con sus cabeceras
# (así no depende de que X-Accel-Buffering llegue). Sin add_header: hereda las cabeceras de seguridad del servidor, como /api/.
#  - proxy_buffering off / proxy_cache off / gzip off: cada evento y cada latido salen de inmediato y sin transformar.
#  - proxy_read_timeout 120s: la API envía un latido cada 25 s; el margen tolera ~4 latidos perdidos antes de cortar (con 60 s
#    bastaría; un valor de horas dejaría abiertas conexiones muertas). El navegador reconecta solo (retry: 4000).
#  - El cierre por sesión revocada lo hace la API; Nginx solo propaga el cierre al cliente.
location = /api/events {
    limit_req zone=api_zone burst=40 nodelay;
    proxy_pass http://lumenza_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # igual que /api/: la API confía solo en este proxy (trust proxy = 1)
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 120s;
    proxy_send_timeout 60s;
    proxy_hide_header X-Powered-By;
    proxy_hide_header Strict-Transport-Security;   # HSTS lo gestiona Nginx (evita cabeceras duplicadas)
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
