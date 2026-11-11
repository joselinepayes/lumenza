import { useAuthConfig } from '../../lib/auth';

/** Solo se muestra si el backend tiene Google OAuth realmente configurado. */
export function GoogleSection({ label }: { label: string }) {
  const { data } = useAuthConfig();
  if (!data?.google) return null;
  return (
    <>
      <a
        href="/api/auth/google"
        className="inline-flex h-11 items-center justify-center gap-2.5 rounded-md border border-line bg-surface text-sm font-medium text-ink transition-[border-color,box-shadow] duration-200 hover:border-accent hover:shadow-[var(--glow)]"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
          <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
          <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
        </svg>
        {label}
      </a>
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-ink-2" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
      </div>
    </>
  );
}

const messages: Record<string, string> = {
  google_not_configured: 'El inicio de sesión con Google no está disponible en este entorno.',
  google_cancelled: 'Cancelaste el inicio de sesión con Google.',
  google_state: 'La sesión de Google expiró o no es válida. Inténtalo de nuevo.',
  google_failed: 'No pudimos completar el inicio de sesión con Google.',
  google_email_not_verified: 'Tu cuenta de Google no tiene el correo verificado.',
  google_account_conflict: 'No pudimos crear tu cuenta con Google. Intenta con correo y contraseña.',
};
export const oauthErrorMessage = (code: string | null) => (code ? (messages[code] ?? null) : null);
