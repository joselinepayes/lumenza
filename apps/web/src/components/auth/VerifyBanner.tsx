import { useMutation } from '@tanstack/react-query';
import { MailWarning } from 'lucide-react';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/** Aviso persistente mientras el correo no esté verificado (estado leído de PostgreSQL vía /auth/me). */
export function VerifyBanner() {
  const { user } = useAuth();
  const m = useMutation({ mutationFn: () => api('/auth/resend-verification', { method: 'POST' }) });
  if (!user || user.emailVerified) return null;
  return (
    <div className="rise mb-8 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line bg-surface px-4 py-3.5" role="region" aria-label="Verificación de correo">
      <MailWarning className="size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1 basis-48 text-sm">
        <p className="font-medium">Confirma tu correo</p>
        <p className="text-ink-2" role="status" aria-live="polite">
          {m.isSuccess ? `Enviamos un nuevo enlace a ${user.email}.` : m.isError ? m.error.message : `Te enviamos un enlace a ${user.email}.`}
        </p>
      </div>
      <Button variant="secondary" size="sm" loading={m.isPending} disabled={m.isSuccess} onClick={() => m.mutate()}>
        {m.isSuccess ? 'Enviado' : 'Reenviar'}
      </Button>
    </div>
  );
}
