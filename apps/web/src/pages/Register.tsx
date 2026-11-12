import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { GoogleSection } from '../components/auth/GoogleButton';
import { Recaptcha } from '../components/auth/Recaptcha';
import { Button } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { ApiError, api } from '../lib/api';
import { useAuthConfig, type User } from '../lib/auth';
import { usePageTitle } from '../lib/title';

const schema = z
  .object({
    displayName: z.string().trim().min(1, 'Ingresa tu nombre').max(60),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,30}$/, '3–30 caracteres: letras, números, punto o guion bajo'),
    email: z.string().trim().toLowerCase().email('Correo inválido'),
    password: z.string().min(10, 'Mínimo 10 caracteres').refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Debe incluir letras y números'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Las contraseñas no coinciden' });
type Form = z.infer<typeof schema>;

function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Register() {
  usePageTitle('Registro');
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: config } = useAuthConfig();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const { register, handleSubmit, watch, setError, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), mode: 'onTouched' });

  const username = useDebounced((watch('username') ?? '').trim().toLowerCase());
  const validName = /^[a-z0-9_.]{3,30}$/.test(username);
  const avail = useQuery({
    queryKey: ['username', username],
    queryFn: () => api<{ available: boolean }>(`/auth/username-available?u=${encodeURIComponent(username)}`),
    enabled: validName,
    staleTime: 15_000,
  });

  const m = useMutation({
    mutationFn: (v: Form) => api<{ user: User }>('/auth/register', { method: 'POST', body: { ...v, captchaToken: captcha ?? undefined } }),
    onSuccess: ({ user }) => {
      qc.setQueryData(['me'], user);
      nav('/inicio', { replace: true });
    },
    onError: (e) => {
      setCaptcha(null);
      setCaptchaReset((n) => n + 1);
      if (e instanceof ApiError && e.code === 'username_taken') setError('username', { message: e.message });
      if (e instanceof ApiError && e.code === 'email_taken') setError('email', { message: e.message });
    },
  });

  const taken = validName && avail.data?.available === false;
  const usernameHint = validName && avail.data?.available ? 'Nombre de usuario disponible' : undefined;
  const generalError = m.error && !(m.error instanceof ApiError && ['username_taken', 'email_taken'].includes(m.error.code)) ? m.error.message : null;
  const needCaptcha = Boolean(config?.recaptcha) && !captcha;

  return (
    <AuthLayout
      title="Crea tu cuenta"
      subtitle="Únete a LUMENZA y comparte tu mirada."
      footer={<>¿Ya tienes cuenta? <Link to="/login" className="font-medium text-accent-soft hover:underline">Iniciar sesión</Link></>}
    >
      <div className="mb-4 flex flex-col gap-4"><GoogleSection label="Registrarse con Google" /></div>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="flex flex-col gap-4" noValidate>
        {generalError && (
          <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{generalError}</div>
        )}
        <Field label="Nombre" autoComplete="name" error={errors.displayName?.message} {...register('displayName')} />
        <Field label="Nombre de usuario" autoComplete="username" autoCapitalize="none" error={errors.username?.message ?? (taken ? 'Ese nombre de usuario ya está en uso' : undefined)} hint={usernameHint} {...register('username')} />
        <Field label="Correo" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <Field label="Contraseña" type="password" autoComplete="new-password" hint="Mínimo 10 caracteres, con letras y números." error={errors.password?.message} {...register('password')} />
        <Field label="Confirmar contraseña" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        {config?.recaptcha && <Recaptcha siteKey={config.recaptcha.siteKey} onToken={setCaptcha} resetKey={captchaReset} />}
        <Button type="submit" size="lg" loading={m.isPending} disabled={taken || needCaptcha}>Crear cuenta</Button>
      </form>
    </AuthLayout>
  );
}
