import dotenv from 'dotenv';
dotenv.config({ path: '../../.env', quiet: true });

export const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
const MAILPIT = 'http://localhost:8025/api/v1';

interface Mail {
  subject: string;
  text: string;
  html: string;
}

/** Lee correos REALES capturados por Mailpit (SMTP local) para la dirección indicada. */
export async function mailsTo(address: string): Promise<Mail[]> {
  const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as { messages: { ID: string; Subject: string }[] };
  return Promise.all(
    list.messages.map(async (m) => {
      const d = (await (await fetch(`${MAILPIT}/message/${m.ID}`)).json()) as { Text: string; HTML: string };
      return { subject: m.Subject, text: d.Text, html: d.HTML };
    }),
  );
}

/** Espera (hasta 5 s) a que llegue un correo y devuelve el token del enlace. */
export async function waitForToken(address: string, subjectPart: string, minCount = 1): Promise<string> {
  for (let i = 0; i < 25; i++) {
    const mails = (await mailsTo(address)).filter((m) => m.subject.includes(subjectPart));
    if (mails.length >= minCount) {
      const m = mails[0]!.text.match(/token=([A-Za-z0-9_-]+)/);
      if (m) return m[1]!;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No llegó el correo "${subjectPart}" a ${address}`);
}

export async function deleteMailsTo(address: string) {
  const list = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${address}`)}`)).json()) as { messages: { ID: string }[] };
  if (list.messages.length) await fetch(`${MAILPIT}/messages`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: list.messages.map((m) => m.ID) }) });
}
