import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { Recaptcha } from '../components/auth/Recaptcha';
import { StatusPanel } from '../components/auth/StatusPanel';
import { Button, ButtonLink } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { api } from '../lib/api';
import { useAuthConfig } from '../lib/auth';

const schema = z.object({ email: z.string().trim().toLowerCase().email('Ingresa un correo válido') });
type Form = z.infer<typeof schema>;

export default function ForgotPassword() {
  const { data: config } = useAuthConfig();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema) });

  const m = useMutation({
    mutationFn: (v: Form) => api('/auth/forgot-password', { method: 'POST', body: { ...v, captchaToken: captcha ?? undefined } }),
    onSuccess: (_d, v) => setSentTo(v.email),
    onError: () => {
      setCaptcha(null);
      setCaptchaReset((n) => n + 1);
    },
  });
  const needCaptcha = Boolean(config?.recaptcha) && !captcha;

  if (sentTo) {
    return (
      <AuthLayout title="" subtitle="" footer={null} hideHeading>
        <StatusPanel
          tone="mail"
          title="Revisa tu correo"
          actions={<ButtonLink to="/login" variant="secondary" size="lg">Volver a iniciar sesión</ButtonLink>}
        >
          Si existe una cuenta con <strong className="font-medium text-ink">{sentTo}</strong>, te enviamos un enlace para crear una nueva contraseña. Vence en 30 minutos.
        </StatusPanel>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Recupera tu acceso"
      subtitle="Te enviaremos un enlace seguro para crear una nueva contraseña."
      footer={<>¿La recordaste? <Link to="/login" className="font-medium text-accent-soft hover:underline">Iniciar sesión</Link></>}
    >
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="flex flex-col gap-4" noValidate>
        {m.error && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{m.error.message}</div>}
        <Field label="Correo" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        {config?.recaptcha && <Recaptcha siteKey={config.recaptcha.siteKey} onToken={setCaptcha} resetKey={captchaReset} />}
        <Button type="submit" size="lg" loading={m.isPending} disabled={needCaptcha}>Enviar enlace</Button>
      </form>
    </AuthLayout>
  );
}
