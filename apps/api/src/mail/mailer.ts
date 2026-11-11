import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Contrato de correo; la lógica de negocio no conoce el proveedor (Mailpit en local, SMTP real en producción). */
export interface Mailer {
  send(m: MailMessage): Promise<void>;
}

class SmtpMailer implements Mailer {
  private transport = nodemailer.createTransport(`${env.SMTP_URL ?? 'smtp://localhost:1025'}?connectionTimeout=5000&socketTimeout=8000`);
  async send(m: MailMessage) {
    await this.transport.sendMail({ from: env.MAIL_FROM, ...m });
  }
}

let instance: Mailer | undefined;
export const getMailer = (): Mailer => (instance ??= new SmtpMailer());

/** Envío tolerante: un fallo de correo se registra (sin contenido sensible) y no rompe la petición. */
export async function trySend(mailer: Mailer, m: MailMessage): Promise<boolean> {
  try {
    await mailer.send(m);
    return true;
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'No se pudo enviar el correo');
    return false;
  }
}
