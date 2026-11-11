# Autenticación multifactor TOTP (Incremento A)

Basado en RFC 6238 (TOTP) y OWASP Authentication/MFA Cheat Sheets. No se usó código de SIGOAST (no se tiene acceso).

## Qué protege
- Segundo factor **opcional** para cualquier usuario; **obligatorio para administradores** (rol `admin`).
- Compatible con **Google Authenticator** y **Microsoft Authenticator** (otpauth://totp, SHA-1, 6 dígitos, 30 s, emisor `LUMENZA`).
- **Ningún camino de inicio de sesión puede saltárselo**: contraseña local y Google OAuth comparten la misma decisión (`mfaService.gate`, que consulta la BD). Una prueba de integración detectó y corrigió un fallo en el camino de Google durante el desarrollo.

## Flujos
| Flujo | Descripción |
|---|---|
| **Activar** (Ajustes → Seguridad) | `POST /auth/mfa/setup` (sesión + **contraseña actual**; en cuentas solo-Google, sesión creada hace ≤10 min) → secreto 160 bits + QR (PNG negro/blanco) + clave manual. `POST /auth/mfa/enable {code}`: solo activa con un **código válido**; entrega **10 códigos de recuperación** (una sola vez); cierra las demás sesiones. |
| **Login (2 pasos)** | Contraseña correcta → **no se crea sesión**; se emite un desafío (cookie `lz_mfa` HttpOnly, 10 min, un único desafío vivo por usuario). `POST /auth/mfa/verify {code \| recoveryCode}` crea la sesión. Google: el callback redirige a `/login/mfa` por el mismo desafío. |
| **Recuperación** | Código `XXXXX-XXXXX` de un solo uso (insensible a mayúsculas/espacios/guion); avisa cuántos quedan. |
| **Regenerar / desactivar** | Exigen **contraseña (o sesión reciente) + un factor válido** (TOTP o recuperación); regenerar invalida los códigos anteriores; ambos cierran las demás sesiones. Un administrador **no puede desactivar**. |
| **Administradores** | Sin MFA, el login crea una sesión de **alcance `mfa_setup`**: solo `/api/auth/*` (enrolar o cerrar sesión); el resto de la API responde 403 `mfa_enrollment_required` y el frontend los lleva a Ajustes. Al activar, la sesión pasa a alcance completo. |
| **Restablecer contraseña** | No desactiva MFA (el siguiente login sigue exigiéndolo). |

## Controles de seguridad
- **Secretos cifrados** en reposo: AES-256-GCM, IV aleatorio por cifrado, **AAD = id de usuario** (un secreto copiado a otra fila no descifra), formato versionado `v1.<iv>.<tag>.<ct>`. Clave `MFA_ENCRYPTION_KEY` (32 bytes base64) **independiente de `SESSION_SECRET`**; sin clave el MFA queda deshabilitado (no hay clave por defecto; obligatoria en producción: la API no arranca sin ella). El secreto en claro solo se muestra en el alta y nunca vuelve a consultarse.
- **Códigos de recuperación**: 50 bits cada uno; en BD solo **HMAC-SHA256** con clave derivada por HKDF; un solo uso atómico.
- **Anti-reutilización**: se guarda el último paso TOTP aceptado (`last_used_step`) y se actualiza con `UPDATE … WHERE last_used_step < paso` (atómico, resistente a carreras). Ventana de deriva ±1 paso (±30 s).
- **Fuerza bruta**: 5 intentos por desafío (después muere y hay que iniciar sesión de nuevo); **10 fallos/15 min por usuario** → bloqueo 429 `mfa_locked` (incluso con código correcto, y también para activar/desactivar); límite por IP (10/15 min); mensajes genéricos; todo en `audit_log` (`auth.mfa_*`) **sin secretos ni códigos**.
- **Desafío**: token aleatorio de 256 bits, solo su SHA-256 en BD, un solo uso, 10 min; cookie HttpOnly, SameSite=Lax, ruta `/api/auth/mfa`.
- CSRF por `Origin` en todos los POST (heredado); reautenticación en cada operación sensible.

## Compatibilidad y operación
- Hora del dispositivo desviada > 30 s hace fallar los códigos (mensaje lo indica).
- Rotación de clave: el prefijo `v1` permite introducir `v2` y re-cifrar; **no implementado** (ver limitaciones).
- Configuración: ver `.env.example` (`MFA_ENCRYPTION_KEY`).

## Limitaciones conocidas
- **Sin recuperación autoservicio** si se pierden el dispositivo y todos los códigos (requiere intervención manual verificada del operador; no hay herramienta administrativa todavía).
- Sin rotación automática de `MFA_ENCRYPTION_KEY`; sin notificación por correo al activar/desactivar MFA; sin gestión de dispositivos de confianza («recordar este navegador»).
- Google OAuth real y SMTP siguen sin validarse con credenciales reales; la integración Google+MFA se probó con un proveedor simulado (lógica del callback, no Google real).
- Las contraseñas y TOTP viajan solo por HTTPS en producción (cookies `Secure`); en local es HTTP.
- Passkeys y cuenta del evaluador: incrementos posteriores (ver `PLAN_SEGURIDAD_Y_EVALUACION.md`).
