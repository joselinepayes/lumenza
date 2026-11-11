import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { GoogleSection, oauthErrorMessage } from '../components/auth/GoogleButton';
import { Recaptcha } from '../components/auth/Recaptcha';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { api } from '../lib/api';
import { useAuthConfig, type User } from '../lib/auth';

const schema = z.object({ identifier: z.string().trim().min(3, 'Ingresa tu correo o usuario'), password: z.string().min(1, 'Ingresa tu contraseña') });
type Form = z.infer<typeof schema>;

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const oauthError = oauthErrorMessage(params.get('error'));
  const { data: config } = useAuthConfig();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema) });

  const m = useMutation({
    mutationFn: (v: Form) => api<{ user?: User; mfaRequired?: boolean; mfaEnrollmentRequired?: boolean }>('/auth/login', { method: 'POST', body: { ...v, captchaToken: captcha ?? undefined } }),
    onSuccess: (r) => {
      // Credenciales correctas pero con MFA activo: aún no hay sesión → segundo paso
      if (r.mfaRequired) return nav('/login/mfa', { replace: true, state: loc.state });
      qc.setQueryData(['me'], r.user);
      nav(r.mfaEnrollmentRequired ? '/ajustes/seguridad' : ((loc.state as { from?: string } | null)?.from ?? '/inicio'), { replace: true });
    },
    onError: () => {
      setCaptcha(null);
      setCaptchaReset((n) => n + 1);
    },
  });
  const needCaptcha = Boolean(config?.recaptcha) && !captcha;

  return (
    <AuthLayout
      title="Bienvenido de nuevo"
      subtitle="Inicia sesión para volver a tu galería."
      footer={<>¿Aún no tienes cuenta? <Link to="/registro" className="font-medium text-accent-soft hover:underline">Crear cuenta</Link></>}
    >
      <div className="mb-4 flex flex-col gap-4"><GoogleSection label="Continuar con Google" /></div>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="flex flex-col gap-4" noValidate>
        {(m.error || oauthError) && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {m.error?.message ?? oauthError}
          </div>
        )}
        <Field label="Correo o usuario" autoComplete="username" error={errors.identifier?.message} {...register('identifier')} />
        <Field label="Contraseña" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <Link to="/recuperar" className="-mt-2 self-end text-sm text-ink-2 transition-colors hover:text-accent-soft">¿Olvidaste tu contraseña?</Link>
        {config?.recaptcha && <Recaptcha siteKey={config.recaptcha.siteKey} onToken={setCaptcha} resetKey={captchaReset} />}
        <Button type="submit" size="lg" loading={m.isPending} disabled={needCaptcha}>Iniciar sesión</Button>
      </form>
    </AuthLayout>
  );
}
