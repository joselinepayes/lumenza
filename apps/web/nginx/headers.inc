# Cabeceras de seguridad. Se INCLUYEN en cada bloque que declara add_header (Nginx no hereda los del servidor en ese caso).
# CSP: sin 'unsafe-inline' en scripts; reCAPTCHA de Google permitido para el captcha real.
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
include /etc/nginx/lumenza/hsts.inc;   # vacío en HTTP; con HSTS cuando TLS_MODE=on (lo genera 05-select-config.sh)
