# Despliegue de LUMENZA en AWS EC2 (Docker Compose + Nginx + Amazon S3 con rol IAM)

> Estado: **preparado y verificado localmente; NO desplegado en AWS.** Todo lo marcado «(no verificado en AWS)» solo puede
> comprobarse en la instancia real. Esta guía no crea recursos de pago ni toca CloudStore.

## 0. Resumen

| Tema | Decisión |
|---|---|
| Servicios | `web` (Nginx + React), `api` (Express), `worker` (Sharp + detección de rostros), `db` (PostgreSQL 17), `migrate` (una vez por arranque) y, solo para emitir HTTPS, `certbot` (perfil `tls`). |
| Redis | **No existe**: la cola de trabajos usa PostgreSQL (pg-boss). Menos memoria y nada más que proteger. |
| Mailpit / RustFS | **No** se despliegan (son de desarrollo). Correo real por SMTP externo; imágenes en Amazon S3. |
| Puertos públicos | Solo **80 y 443** (Nginx). PostgreSQL y la API **no publican puertos**; PostgreSQL vive en una red Docker `internal` (sin salida a Internet). |
| S3 | Rol IAM de la instancia (credenciales temporales por IMDSv2). **Sin claves AWS en ningún archivo.** |
| Archivos | `deploy/aws/docker-compose.aws.yml`, `.env.aws.example`, `lumenza.sh`, `pack-for-ec2.sh`, `iam-policy-s3.example.json`, `apps/web/Dockerfile`, `apps/web/nginx/*`, `apps/api/Dockerfile`. El `docker-compose.yml` de la raíz (desarrollo) **no se modificó**. |

### ¿Es viable con 2 GiB de RAM (t3.small)? — **Sí, con condiciones** (para una demostración/entrega académica, no para carga alta)

Mediciones reales (stack de producción en Docker, una sola foto procesándose a la vez, `docker stats` cada ~1 s):

| Contenedor | Reposo | Pico medido | Límite en Compose |
|---|---|---|---|
| `db` (PostgreSQL) | 21–70 MiB | 78 MiB | 384 MiB |
| `api` (Express) | 51 MiB | 112 MiB | 320 MiB |
| `worker` (Sharp + TF.js/WASM) | 41–54 MiB | **477 MiB** con una foto de 60 MP (el máximo admitido) en un worker recién iniciado; **768 MiB** (el límite) tras procesar seguidas fotos de 12, 35 y 48 MP, y se quedó en ≈670 MiB (la memoria WASM/libvips no se devuelve al SO) | 768 MiB (+swap hasta 1 GiB) |
| `web` (Nginx) | 8 MiB | 9 MiB | 64 MiB |
| **Suma de picos** | ≈ 120 MiB | **≈ 970 MiB** | |

Tiempos medidos (CPU local, sin comparar con el t3.small): 12 MP ≈ 23 s, 35 MP ≈ +15 s, 48 MP ≈ +30 s y 60 MP ≈ 25 s en total (incluye 3 transformaciones, miniatura y detección de rostros). En un t3.small (2 vCPU con créditos) espera tiempos **similares o algo mayores**; no se ha medido en AWS.

Del total de 2 GiB, el sistema operativo + Docker + SSH ocupan ≈ 0,5–0,6 GiB (usted midió ≈ 1,4 GiB disponibles al inicio). Con **≈ 1 GiB de pico de contenedores** queda margen de ≈ 0,4 GiB. Condiciones para que sea seguro:
1. **Archivo de swap de 2 GiB** (paso B3) y `vm.swappiness=10`.
2. **No compilar las imágenes en la EC2** si se puede evitar (compilar el frontend y la API pide ≈ 1–1,5 GiB): construirlas en su PC y cargarlas con `docker save/load` (paso B9, opción B). Si se compilan en la EC2, con swap funciona pero lento (tiempo **no medido**).
3. El worker procesa **una foto a la vez** (`WORKER_CONCURRENCY=1`) y las demás esperan en la cola: es intencionado.
4. Sin más servicios en la instancia. Vigile con `./lumenza.sh stats` y `free -m`; si el worker llega a su límite con frecuencia, reiniciarlo (`./lumenza.sh restart worker`) devuelve su memoria, o suba a t3.medium (4 GiB) — **decisión de coste suya**.
5. Límites: ≈ 1–5 usuarios concurrentes; no es una configuración para tráfico real. t3 es «burstable»: usar CPU sostenida por encima de la línea base consume créditos (con el modo `unlimited` por defecto puede generar un pequeño cargo adicional).

**Disco** (medido): imagen `lumenza-api` 862 MB, `lumenza-web` 95 MB, PostgreSQL ≈ 420 MB, Nginx ≈ 95 MB, certbot ≈ 120 MB ⇒ **≈ 1,6 GB de imágenes**. Datos: base de datos pequeña (≈ 50 MB tras pruebas) y **las fotos van a S3, no al disco**. Los logs están limitados (3 × 10 MB por contenedor). Con ≈ 16 GiB libres sobra espacio; la caché de construcción de Docker puede crecer varios GB si se compila en la EC2 (`docker builder prune -f` la libera; solo borra caché de build).

## 1. Qué se verificó y qué NO

Verificado localmente con Docker (proyecto aislado `lumenzaaws`, puerto 8081, S3 sustituido por RustFS **solo para la prueba**):
- Construcción de las imágenes; arranque desde una base de datos **vacía** con las 6 migraciones; `migrate → api/worker → web` en orden y todos *healthy*.
- Pruebas de salud (`./lumenza.sh health`): Nginx, SPA, API, API→PostgreSQL, API→almacenamiento S3, rutas privadas 401, cabeceras de seguridad, **no exposición de puertos**.
- Registro, login, publicación y procesamiento de fotos grandes (12/35/48/60 MP) a través de Nginx; las imágenes se ven en el navegador con la **CSP estricta** (0 violaciones).
- Respaldo → borrado de datos → **restauración** (1 usuario, 4 publicaciones, 20 variantes, 6 migraciones, extensiones).
- `stop`, `start`, `restart`, `down` + `up` (los datos persisten; los volúmenes no se borran).
- Modo HTTPS de Nginx con un certificado autofirmado de prueba: redirección 301, HSTS en todas las rutas, negativa a arrancar sin certificado.
- Batería completa del proyecto (typecheck, unitarias, integración, E2E, build) tras los cambios.

**No verificado (requiere AWS real):** acceso a S3 con el **rol IAM** y a IMDSv2 desde el contenedor (hop limit), emisión del certificado Let's Encrypt, HTTP/2, compilación en un t3.small, tiempos de procesamiento en esa CPU, envío de correo y Google/reCAPTCHA reales.

## 2. Requisitos externos pendientes (marcar antes de desplegar)

| # | Pendiente | Dónde | Notas |
|---|---|---|---|
| 1 | **Security group**: entrada 22 (solo **su IP**), 80 y 443 (0.0.0.0/0). Nada más (5432/6379/4000 **cerrados**) | Consola EC2 | |
| 2 | **IMDSv2 con hop limit = 2** | Consola EC2 → Acciones → Configuración de la instancia → Modificar opciones de metadatos, o `aws ec2 modify-instance-metadata-options --instance-id <ID> --http-tokens required --http-put-response-hop-limit 2 --region us-east-2` | Sin esto, **los contenedores no obtienen las credenciales del rol** (con hop limit 1 solo las ve el host). |
| 3 | **Política IAM del rol `LUMENZA-EC2-Role`** limitada al bucket (`deploy/aws/iam-policy-s3.example.json`): `s3:ListBucket` (bucket) y `s3:GetObject/PutObject/DeleteObject` (objetos) | IAM | `ListBucket` es necesario para el chequeo `/api/ready`. |
| 4 | **Bucket**: *Block Public Access* activado (4 opciones), cifrado por defecto SSE-S3, ACL deshabilitadas, sin política pública | S3 | Las fotos se sirven por la API con control de privacidad; el bucket **nunca** debe ser público. Recomendado: versionado. |
| 5 | **IP elástica** asociada a la instancia | EC2 | Evita que cambie la IP al reiniciar. Una IP elástica **sin asociar** genera cargo; asociada no añade coste sobre el IPv4 público. |
| 6 | **Dominio** con registro A → IP elástica | su proveedor DNS | Imprescindible para HTTPS, Google OAuth y correo creíble. |
| 7 | **Certificado TLS** (Let's Encrypt gratuito) | `./lumenza.sh tls-issue` | Requiere #6 y los puertos 80/443 abiertos. |
| 8 | **SMTP real** (p. ej. Amazon SES: identidad verificada, salir del *sandbox*, credenciales SMTP) → `SMTP_URL` y `MAIL_FROM` | SES | Sin SMTP no llegan los correos de verificación ni de recuperación. SES SMTP usa credenciales propias (no el rol IAM). Puertos 465/587 permitidos; el 25 suele estar bloqueado. |
| 9 | **reCAPTCHA v2** (`RECAPTCHA_SITE_KEY`/`SECRET_KEY`) con el dominio real | Google | Obligatorio en el estado final. |
| 10 | **Google OAuth**: cliente OAuth con `https://<dominio>/api/auth/google/callback` y `GOOGLE_*` | Google Cloud | Google exige HTTPS en dominios reales. |
| 11 | **Guardar fuera de la instancia** `MFA_ENCRYPTION_KEY` y `POSTGRES_PASSWORD` (gestor de secretos) | su equipo | Sin `MFA_ENCRYPTION_KEY` los secretos TOTP guardados no se pueden descifrar. |

## 3. Procedimiento paso a paso

Convenciones: `PC$` = su equipo (Git Bash en Windows, o Linux/macOS), `EC2$` = terminal Ubuntu de la instancia. Sustituya `<CLAVE.pem>`, `<IP>`.

### Fase A — antes de entrar a la EC2 (consola AWS)
Complete los pendientes **#1, #2, #3, #4 y #5** de la tabla anterior.

### Fase B — en la EC2

**B1. Conectar y comprobar lo básico**
```bash
PC$ ssh -i <CLAVE.pem> ubuntu@<IP>
EC2$ docker --version && docker compose version && docker ps          # debe funcionar SIN sudo
EC2$ sudo apt-get update && sudo apt-get install -y openssl curl       # normalmente ya instalados
```
Si `docker ps` pide sudo: `sudo usermod -aG docker $USER` y vuelva a entrar por SSH.

**B2. Directorio de trabajo**
```bash
EC2$ sudo chown -R $USER:$USER /opt/lumenza
```

**B3. Swap de 2 GiB (obligatorio con 2 GiB de RAM)**
```bash
EC2$ sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
EC2$ echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
EC2$ echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-lumenza-swap.conf && sudo sysctl --system >/dev/null
EC2$ free -m            # Swap: 2047
```

**B4. Empaquetar y transferir (desde su PC, en la raíz del repositorio)**
```bash
PC$ bash deploy/aws/pack-for-ec2.sh          # crea lumenza-deploy.tar.gz + lumenza-deploy.sha256 (sin secretos)
PC$ scp -i <CLAVE.pem> lumenza-deploy.tar.gz lumenza-deploy.sha256 ubuntu@<IP>:~
EC2$ cd ~ && sha256sum -c lumenza-deploy.sha256          # debe decir: lumenza-deploy.tar.gz: OK
EC2$ tar -xzf lumenza-deploy.tar.gz -C /opt/lumenza && cd /opt/lumenza/deploy/aws && chmod +x lumenza.sh
```

**B5. Crear el `.env` con secretos aleatorios y completarlo**
```bash
EC2$ ./lumenza.sh secrets                  # crea .env (permisos 600) con POSTGRES_PASSWORD, SESSION_SECRET y MFA_ENCRYPTION_KEY aleatorios
EC2$ nano .env
```
Edite **solo** estas líneas (el resto queda como está):
```
PUBLIC_URL=http://<IP_ELASTICA>            # prueba inicial sin dominio. Con dominio+HTTPS: https://tu.dominio
S3_BUCKET=<nombre-exacto-de-su-bucket>
S3_REGION=us-east-2
```
Mientras no haya HTTPS, deje `COOKIE_SECURE=false` y `ALLOW_MISSING_INTEGRATIONS=true` (el script y la API lo avisan; **no es el estado final**).
Copie ahora `MFA_ENCRYPTION_KEY` y `POSTGRES_PASSWORD` a su gestor de secretos.

**B6. Preflight**
```bash
EC2$ ./lumenza.sh preflight               # debe terminar con «Preflight correcto» (los AVISO de modo HTTP temporal son esperados)
EC2$ ./lumenza.sh config                  # «Compose válido»
```

**B7. Imágenes — elija UNA opción**

*Opción A (recomendada): compilar en su PC y cargar en la EC2* (evita el pico de memoria de la compilación)
```bash
PC$ docker build -f apps/api/Dockerfile -t lumenza-api:local .
PC$ docker build -f apps/web/Dockerfile -t lumenza-web:local .
PC$ docker pull postgres:17-alpine
PC$ docker save lumenza-api:local lumenza-web:local postgres:17-alpine | gzip > lumenza-images.tar.gz     # ≈ 700 MB
PC$ scp -i <CLAVE.pem> lumenza-images.tar.gz ubuntu@<IP>:~
EC2$ ./lumenza.sh load ~/lumenza-images.tar.gz && docker images | grep -E "lumenza|postgres"
```
*Opción B: compilar en la EC2* (necesita el swap del paso B3; lento)
```bash
EC2$ ./lumenza.sh build
EC2$ docker builder prune -f          # opcional: libera la caché de compilación (solo caché)
```
Compilar **para x86_64** (su instancia es x86_64). Si su PC es ARM (Mac M1/M2), use la opción B o `docker build --platform linux/amd64`.

**B8. Verificar el acceso a Amazon S3 con el rol IAM** (antes de levantar todo)
```bash
EC2$ ./lumenza.sh s3-check
```
Debe mostrar «El contenedor alcanza IMDSv2» y «Amazon S3 accesible con el rol IAM (put/get/delete)». Si falla, vea la sección 7.

**B9. Levantar LUMENZA**
```bash
EC2$ ./lumenza.sh up           # ejecuta las migraciones, arranca todo y lanza las pruebas de salud
EC2$ ./lumenza.sh health       # puede repetirse cuando quiera; debe terminar con «Todas las pruebas de salud pasaron»
```
Desde su navegador: `http://<IP_ELASTICA>` → registre un usuario, publique una foto y espere a que el worker genere las versiones.
Nota: sin SMTP no llegará el correo de verificación (esperado hasta completar el pendiente #8).

**B10. Respaldo automático diario y arranque automático**
```bash
EC2$ ./lumenza.sh backup                                       # primer respaldo (prueba)
EC2$ (crontab -l 2>/dev/null; echo '15 3 * * * cd /opt/lumenza/deploy/aws && ./lumenza.sh backup >> backups/backup.log 2>&1') | crontab -
EC2$ sudo systemctl enable docker                              # los contenedores tienen restart: unless-stopped
```

### Fase C — HTTPS (cuando exista dominio)
Requisitos: pendientes **#6 y #7**.
```bash
EC2$ nano .env     # SERVER_NAME=tu.dominio   (TLS_MODE sigue en off)
EC2$ ./lumenza.sh up                                           # recrea web con el nuevo SERVER_NAME
EC2$ ./lumenza.sh tls-issue                                    # pide el certificado (reto HTTP en el puerto 80)
EC2$ nano .env     # TLS_MODE=on  PUBLIC_URL=https://tu.dominio  COOKIE_SECURE=true  (+ GOOGLE_REDIRECT_URI=https://tu.dominio/api/auth/google/callback)
EC2$ ./lumenza.sh up && ./lumenza.sh health
EC2$ (crontab -l; echo '0 4 * * 1 cd /opt/lumenza/deploy/aws && ./lumenza.sh tls-renew >> backups/tls.log 2>&1') | crontab -
```
Con `TLS_MODE=on` y sin certificado, Nginx **se niega a arrancar** con un mensaje claro (probado). Con HTTPS activo se añade HSTS y 80→443.

### Fase D — completar las integraciones (estado final de entrega)
Rellene `SMTP_URL`, `MAIL_FROM`, `RECAPTCHA_*`, `GOOGLE_*` en `.env`, ponga `ALLOW_MISSING_INTEGRATIONS=false` y `COOKIE_SECURE=true`, y ejecute `./lumenza.sh up && ./lumenza.sh health`. La API **se niega a arrancar** en producción si falta alguna (probado con la imagen de producción: termina con código 1 y lista exactamente lo que falta; con `ALLOW_MISSING_INTEGRATIONS=true` arranca con advertencias explícitas). Después pruebe de verdad: correo de verificación, reCAPTCHA y «Continuar con Google».

## 4. Operación diaria

| Acción | Comando (en `/opt/lumenza/deploy/aws`) |
|---|---|
| Estado / logs / recursos | `./lumenza.sh status` · `./lumenza.sh logs api` · `./lumenza.sh stats` · `./lumenza.sh disk` |
| Pruebas de salud | `./lumenza.sh health` |
| Detener todo (conserva datos) | `./lumenza.sh stop` |
| Iniciar de nuevo | `./lumenza.sh start` |
| Reiniciar un servicio | `./lumenza.sh restart worker` (reinicia, **no** relee `.env`) |
| Aplicar cambios del `.env` | `./lumenza.sh up` |
| Bajar contenedores y redes (**no borra volúmenes**) | `./lumenza.sh down` |
| Migraciones manuales | `./lumenza.sh migrate` (se ejecutan solas en cada `up`; son idempotentes) |
| Respaldo | `./lumenza.sh backup` |
| Restaurar | `./lumenza.sh restore backups/lumenza-AAAAMMDD-HHMMSS.dump` (pide escribir `RESTAURAR`) |

**Actualizar a una versión nueva:** `bash deploy/aws/pack-for-ec2.sh` en su PC → `scp` → en la EC2 `tar -xzf … -C /opt/lumenza` (no pisa `.env` ni `backups/`, que no van en el paquete) → cargar/compilar imágenes (B7) → `./lumenza.sh backup && ./lumenza.sh up && ./lumenza.sh health`. Para poder volver atrás, etiquete las imágenes: `LUMENZA_VERSION=v2 ./lumenza.sh build` y cambie `LUMENZA_VERSION` en `.env`.

## 5. Respaldo y restauración de PostgreSQL

- `backup`: `pg_dump -Fc` (comprimido, incluye el esquema de la cola pg-boss), **verificado** con `pg_restore --list`, permisos 600, rotación (14 por defecto, `KEEP_BACKUPS`). Las **fotografías no están en el respaldo: viven en S3** (active el versionado del bucket para protegerlas de borrados).
- `restore`: valida el archivo, hace un **respaldo de seguridad previo**, detiene `web/api/worker`, **recrea la base de datos** y restaura sobre una base vacía (no se usa `--clean`: falla con las tablas particionadas de pg-boss; esto se descubrió en las pruebas), reinicia y, si algo falla, **intenta volver al estado anterior automáticamente**.
- Copia fuera de la instancia (haga esto con regularidad):
  `PC$ scp -i <CLAVE.pem> ubuntu@<IP>:/opt/lumenza/deploy/aws/backups/lumenza-*.dump .`
- Después de restaurar, base de datos y bucket pueden diferir ligeramente (publicaciones o borrados posteriores al respaldo): objetos huérfanos en S3 son inofensivos; publicaciones sin objeto mostrarían imagen rota.
- Perder la instancia: cree otra, repita las Fases A–B con el mismo `.env` (mismas `MFA_ENCRYPTION_KEY` y bucket) y restaure el último `.dump`.

## 6. Seguridad aplicada y riesgos residuales

Aplicado: red `internal` para PostgreSQL; solo 80/443 publicados; contenedores `no-new-privileges`, `cap_drop: ALL`, sistema de archivos de solo lectura (api/worker/migrate) con `tmpfs` en `/tmp`, usuario no root (`node`), `init`; límites de memoria; logs rotados; secretos solo en `.env` (600) y fuera del paquete; sin claves AWS; CSP estricta (`script-src 'self'` + reCAPTCHA), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`; límite de peticiones en el borde para `/api` y `/api/auth` además de los de la API; `client_max_body_size 16m`; HSTS con HTTPS; cookies `Secure` por defecto en producción.
Residuales (conocidos): la API y el worker usan un único usuario PostgreSQL con privilegios de propietario de la base (no hay roles separados); una sola instancia (sin alta disponibilidad); sin WAF; endurezca SSH (solo clave, sin root) y active actualizaciones de seguridad automáticas (`unattended-upgrades`) — **no se aplicó, es configuración del servidor**; `ALLOW_MISSING_INTEGRATIONS` y `COOKIE_SECURE=false` son solo para la etapa previa a HTTPS/credenciales.

## 7. Solución de problemas

| Síntoma | Causa probable / acción |
|---|---|
| `s3-check`: «NO alcanza IMDSv2» | Hop limit = 1. Pendiente #2. |
| `s3-check` o `/api/ready` con `storage:false`; «Acceso denegado» | Política IAM sin `ListBucket`/objetos, nombre de bucket o región incorrectos, o *Block Public Access*/política de bucket que deniega al rol. Revise `S3_BUCKET`/`S3_REGION` y la política. |
| No se puede iniciar sesión por HTTP | Las cookies son `Secure` por defecto en producción. Use `COOKIE_SECURE=false` **solo** temporalmente (HTTP) o active HTTPS. |
| La API se detiene al arrancar: «Configuración de producción incompleta» | Faltan `SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, o (`SMTP_URL`/`RECAPTCHA_*` sin `ALLOW_MISSING_INTEGRATIONS=true`). |
| 403 «Origen no permitido» | `PUBLIC_URL` no coincide exactamente con la URL del navegador (esquema, host y puerto). |
| 502 en `/api` | La API no está *healthy*: `./lumenza.sh logs api`. |
| Contenedor `worker` *unhealthy* | `./lumenza.sh logs worker`; suele ser PostgreSQL caído o falta de memoria (revise `./lumenza.sh stats`). |
| Procesamiento muy lento o fotos en cola | Una foto a la vez por diseño; CPU t3 con créditos agotados. Espere o suba de tamaño de instancia. |
| `ERROR: TLS_MODE=on pero no existe …fullchain.pem` | Emita el certificado antes (`tls-issue`). |
| Compilación termina con «Killed» | Falta memoria: use la opción A del paso B7 o verifique el swap. |

## 8. Detalle técnico de los archivos
- `docker-compose.aws.yml`: proyecto `lumenza-aws` (nombre distinto del de desarrollo), redes `data` (interna) y `edge`, volúmenes `pgdata`, `letsencrypt`, `certbot_www`. `migrate` → `api`/`worker` → `web` por dependencias con *healthchecks* (el worker escribe un latido en `/tmp` cada 15 s solo si PostgreSQL responde).
- `apps/web/nginx/`: plantillas `http`/`https` seleccionadas por `TLS_MODE`; `headers.inc` (cabeceras de seguridad, incluido en cada `location` que declara `add_header`); `locations.inc` (API, caché de `/assets`, SPA); `05-select-config.sh` (selección de modo; se niega a arrancar sin certificado).
- Cambios mínimos en el código de la aplicación: `COOKIE_SECURE` y `ALLOW_MISSING_INTEGRATIONS` explícitos (`env.ts`), latido del worker (`worker.ts`), script del tema movido a `public/theme-init.js` (permite CSP sin `unsafe-inline`).
- `docker-compose.localtest.yml` y `.env.localtest` (ignorado por git): **solo** para probar este stack en su PC con RustFS; no se usan en AWS.
