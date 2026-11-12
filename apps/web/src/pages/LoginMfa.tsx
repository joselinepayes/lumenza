import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../components/auth/AuthLayout';
import { CodeInput } from '../components/auth/CodeInput';
import { StatusPanel } from '../components/auth/StatusPanel';
import { Button, ButtonLink } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { useToast } from '../components/ui/Feedback';
import { ApiError, api } from '../lib/api';
import type { User } from '../lib/auth';
import { usePageTitle } from '../lib/title';

interface Challenge { valid: boolean; source: 'password' | 'google'; attemptsLeft: number }

/** Segundo paso del inicio de sesión: aún NO hay sesión; solo existe un desafío de un solo uso (cookie HttpOnly). */
export default function LoginMfa() {
  usePageTitle('Verificación en dos pasos');
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [rc, setRc] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const challenge = useQuery({ queryKey: ['mfa-challenge'], queryFn: () => api<Challenge>('/auth/mfa/challenge'), retry: false, staleTime: 0, gcTime: 0 });

  const m = useMutation({
    mutationFn: (body: { code?: string; recoveryCode?: string }) => api<{ user: User; method: 'totp' | 'recovery'; recoveryRemaining?: number }>('/auth/mfa/verify', { method: 'POST', body }),
    onSuccess: (r) => {
      qc.setQueryData(['me'], r.user);
      if (r.method === 'recovery') toast(`Código de recuperación usado. Te quedan ${r.recoveryRemaining}.`);
      nav((loc.state as { from?: string } | null)?.from ?? '/inicio', { replace: true });
    },
    onError: () => { setCode(''); input.current?.focus(); },
  });

  useEffect(() => { input.current?.focus(); }, [recovery, challenge.isSuccess]);

  const expired = challenge.isError || (m.error instanceof ApiError && m.error.code === 'challenge_expired');
  const locked = m.error instanceof ApiError && m.error.code === 'mfa_locked';

  if (challenge.isPending) return <AuthLayout title="" subtitle="" footer={null} hideHeading><StatusPanel tone="loading" title="Preparando verificación…" /></AuthLayout>;
  if (expired || locked) {
    return (
      <AuthLayout title="" subtitle="" footer={null} hideHeading>
        <StatusPanel tone="error" title={locked ? 'Demasiados intentos' : 'La verificación expiró'} actions={<ButtonLink to="/login" size="lg">Volver a iniciar sesión</ButtonLink>}>
          {locked ? 'Por seguridad bloqueamos temporalmente la verificación. Inténtalo de nuevo en 15 minutos.' : 'Por seguridad el paso de verificación dura 10 minutos o 5 intentos. Inicia sesión de nuevo.'}
        </StatusPanel>
      </AuthLayout>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (recovery ? rc.trim().length >= 10 : code.length === 6) m.mutate(recovery ? { recoveryCode: rc } : { code });
  };

  return (
    <AuthLayout
      title="Verificación en dos pasos"
      subtitle={recovery ? 'Introduce uno de tus códigos de recuperación. Cada código solo sirve una vez.' : 'Introduce el código de 6 dígitos de tu aplicación de autenticación.'}
      footer={<><Link to="/login" className="font-medium text-accent-soft hover:underline">Cancelar</Link> y volver a iniciar sesión</>}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="mb-1 flex items-center gap-2.5 text-sm text-ink-2"><ShieldCheck className="size-4 text-accent" strokeWidth={1.75} aria-hidden />{challenge.data?.source === 'google' ? 'Entraste con Google; falta tu segundo factor.' : 'Contraseña correcta; falta tu segundo factor.'}</div>
        {m.error && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{m.error.message}</div>}
        {recovery ? (
          <Field ref={input} label="Código de recuperación" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXX-XXXXX" value={rc} onChange={(e) => setRc(e.target.value)} />
        ) : (
          <CodeInput ref={input} label="Código de verificación" value={code} onChange={setCode} onComplete={(v) => !m.isPending && m.mutate({ code: v })} />
        )}
        <Button type="submit" size="lg" loading={m.isPending} disabled={recovery ? rc.trim().length < 10 : code.length !== 6}>Verificar</Button>
        <button type="button" onClick={() => { setRecovery((r) => !r); m.reset(); }} className="self-center text-sm text-ink-2 transition-colors hover:text-accent-soft">
          {recovery ? 'Usar el código de mi aplicación' : 'Usar un código de recuperación'}
        </button>
      </form>
    </AuthLayout>
  );
}
