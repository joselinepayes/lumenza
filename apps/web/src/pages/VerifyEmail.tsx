import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AuthLayout } from '../components/auth/AuthLayout';
import { StatusPanel } from '../components/auth/StatusPanel';
import { ButtonLink } from '../components/ui/Button';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useUrlToken } from '../lib/useUrlToken';

const hints: Record<string, string> = {
  token_expired: 'Este enlace venció (dura 24 horas). Inicia sesión y solicita uno nuevo desde tu cuenta.',
  token_used: 'Este enlace ya se utilizó. Si ya confirmaste tu correo, no necesitas hacer nada más.',
  token_invalid: 'No reconocemos este enlace. Revisa que esté completo o solicita uno nuevo desde tu cuenta.',
};

export default function VerifyEmail() {
  const token = useUrlToken();
  const qc = useQueryClient();
  const { user } = useAuth();
  const started = useRef(false);
  const m = useMutation({
    mutationFn: (t: string) => api('/auth/verify-email', { method: 'POST', body: { token: t } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  useEffect(() => {
    if (token && !started.current) {
      started.current = true; // evita doble consumo en StrictMode
      m.mutate(token);
    }
  }, [token, m]);

  const to = user ? '/inicio' : '/login';
  const toLabel = user ? 'Ir a LUMENZA' : 'Iniciar sesión';

  let body;
  if (!token) body = <StatusPanel tone="error" title="Enlace incompleto" actions={<ButtonLink to={to} size="lg">{toLabel}</ButtonLink>}>Abre el enlace completo del correo que te enviamos.</StatusPanel>;
  else if (m.isError) {
    const code = m.error instanceof ApiError ? m.error.code : '';
    body = (
      <StatusPanel tone="error" title={m.error.message} actions={<ButtonLink to={to} size="lg">{toLabel}</ButtonLink>}>
        {hints[code] ?? 'Inténtalo de nuevo en unos minutos.'}
      </StatusPanel>
    );
  } else if (m.isSuccess) body = <StatusPanel tone="success" title="Correo confirmado" actions={<ButtonLink to={to} size="lg">{toLabel}</ButtonLink>}>Gracias. Tu cuenta ya está verificada.</StatusPanel>;
  else body = <StatusPanel tone="loading" title="Confirmando tu correo…" />;

  return <AuthLayout title="" subtitle="" footer={null} hideHeading>{body}</AuthLayout>;
}
