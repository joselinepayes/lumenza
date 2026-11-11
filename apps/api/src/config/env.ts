import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// El .env vive en la raíz del monorepo
dotenv.config({ path: path.resolve(here, '../../../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  SESSION_SECRET: z.string().min(16).default('dev-only-insecure-secret-change-me'),
  // reCAPTCHA y Google OAuth: opcionales; si faltan, la función se reporta como NO configurada (nunca simulada).
  RECAPTCHA_SITE_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  RECAPTCHA_SECRET_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  GOOGLE_CLIENT_ID: z.string().optional().transform((v) => (v ? v : undefined)),
  GOOGLE_CLIENT_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
  GOOGLE_REDIRECT_URI: z.string().optional().transform((v) => (v ? v : undefined)),
  // MFA TOTP: clave de cifrado de secretos (32 bytes en base64). Separada de SESSION_SECRET; sin valor por defecto.
  MFA_ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || Buffer.from(v, 'base64').length === 32, 'MFA_ENCRYPTION_KEY debe ser 32 bytes en base64'),
  // Cola de procesamiento de fotografías (pg-boss sobre PostgreSQL)
  PHOTO_QUEUE: z.string().default('process-photo'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  // Correo: local = Mailpit (smtp://localhost:1025); producción = proveedor SMTP real (smtps://usuario:clave@host:465).
  SMTP_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  MAIL_FROM: z.string().default('LUMENZA <no-reply@lumenza.local>'),
  // Almacenamiento S3. Con S3_ENDPOINT => RustFS/compatible (local); sin él => Amazon S3 real.
  S3_BUCKET: z.string().min(3).default('lumenza-media'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional().transform((v) => (v ? v : undefined)),
  S3_ACCESS_KEY_ID: z.string().optional().transform((v) => (v ? v : undefined)),
  S3_SECRET_ACCESS_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuración inválida:', z.prettifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;

/**
 * Cookies `Secure`: activas por defecto en producción. Solo se pueden desactivar de forma EXPLÍCITA (COOKIE_SECURE=false),
 * p. ej. en una prueba temporal por HTTP sin dominio/certificado; en ese caso la API lo advierte al arrancar.
 */
export const cookieSecure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production';

/**
 * Solo la API lo invoca (el worker no lo necesita). En producción no se desactiva NADA en silencio:
 * - SESSION_SECRET aleatorio y MFA_ENCRYPTION_KEY son siempre obligatorios.
 * - SMTP y reCAPTCHA son obligatorios, salvo que se declare ALLOW_MISSING_INTEGRATIONS=true (etapa de despliegue previa a
 *   tener esas credenciales): entonces arranca con una advertencia clara y esas funciones quedan inactivas.
 */
export function assertProductionConfig() {
  if (env.NODE_ENV !== 'production') return;
  const fatal: string[] = [];
  if (!env.MFA_ENCRYPTION_KEY) fatal.push('MFA_ENCRYPTION_KEY');
  if (env.SESSION_SECRET.startsWith('dev-only')) fatal.push('SESSION_SECRET (aleatorio)');
  const integrations = (['SMTP_URL', 'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET_KEY'] as const).filter((k) => !env[k]);
  if (integrations.length) {
    if (process.env.ALLOW_MISSING_INTEGRATIONS === 'true') {
      console.warn(`ADVERTENCIA: ALLOW_MISSING_INTEGRATIONS=true. Funciones INACTIVAS por falta de ${integrations.join(', ')} (correo de verificación/recuperación y/o reCAPTCHA). No es una configuración final.`);
    } else fatal.push(...integrations);
  }
  if (!cookieSecure) console.warn('ADVERTENCIA: COOKIE_SECURE=false. Las cookies de sesión viajarán sin cifrar si no hay HTTPS. Solo para pruebas temporales.');
  if (fatal.length) {
    console.error(`Configuración de producción incompleta: define ${fatal.join(', ')}`);
    process.exit(1);
  }
}
