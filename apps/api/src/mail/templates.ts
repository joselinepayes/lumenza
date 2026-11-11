import { env } from '../config/env.js';
import type { MailMessage } from './mailer.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Tpl {
  to: string;
  subject: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  url: string;
  note: string;
}

/** Plantilla editorial de marca (HTML con estilos en línea, sin imágenes externas) + versión de texto. */
function render(t: Tpl): MailMessage {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#0b0b10;font-family:Inter,Segoe UI,Arial,sans-serif;color:#f8f8fc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b10"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="520" style="max-width:520px;width:100%;background:#15151d;border:1px solid #292936;border-radius:14px">
<tr><td style="padding:32px 36px 0"><span style="font-family:Georgia,serif;letter-spacing:.28em;font-size:15px;color:#f8f8fc">LUMENZA</span></td></tr>
<tr><td style="padding:28px 36px 0"><p style="margin:0 0 10px;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#c4b5fd">${esc(t.eyebrow)}</p>
<h1 style="margin:0;font-family:Georgia,serif;font-weight:300;font-size:30px;line-height:1.15">${esc(t.title)}</h1></td></tr>
<tr><td style="padding:16px 36px 0;font-size:15px;line-height:1.6;color:#a3a3b5">${esc(t.body)}</td></tr>
<tr><td style="padding:28px 36px 0"><a href="${esc(t.url)}" style="display:inline-block;background:#9673f7;color:#0b0b10;text-decoration:none;font-weight:600;font-size:14px;padding:13px 22px;border-radius:10px">${esc(t.cta)}</a></td></tr>
<tr><td style="padding:24px 36px 0;font-size:12px;line-height:1.6;color:#a3a3b5">Si el botón no funciona, copia este enlace en tu navegador:<br><span style="word-break:break-all;color:#c4b5fd">${esc(t.url)}</span></td></tr>
<tr><td style="padding:24px 36px 32px;font-size:12px;line-height:1.6;color:#a3a3b5;border-top:0">${esc(t.note)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `LUMENZA\n\n${t.title}\n\n${t.body}\n\n${t.cta}: ${t.url}\n\n${t.note}\n`;
  return { to: t.to, subject: t.subject, html, text };
}

export const verifyEmailMail = (to: string, name: string, token: string) =>
  render({
    to,
    subject: 'Confirma tu correo en LUMENZA',
    eyebrow: 'Verificación de correo',
    title: `Bienvenido, ${name}`,
    body: 'Confirma que esta dirección es tuya para activar todas las funciones de tu cuenta. El enlace es de un solo uso y vence en 24 horas.',
    cta: 'Confirmar mi correo',
    url: `${env.WEB_ORIGIN}/verificar-correo?token=${token}`,
    note: 'Si no creaste una cuenta en LUMENZA, puedes ignorar este mensaje.',
  });

export const resetPasswordMail = (to: string, token: string) =>
  render({
    to,
    subject: 'Restablece tu contraseña de LUMENZA',
    eyebrow: 'Seguridad de la cuenta',
    title: 'Restablece tu contraseña',
    body: 'Recibimos una solicitud para crear una nueva contraseña. El enlace es de un solo uso y vence en 30 minutos. Al usarlo se cerrarán todas tus sesiones abiertas.',
    cta: 'Crear nueva contraseña',
    url: `${env.WEB_ORIGIN}/restablecer?token=${token}`,
    note: 'Si no solicitaste este cambio, ignora este correo: tu contraseña actual sigue siendo válida. Nunca te pediremos tu contraseña por correo.',
  });
