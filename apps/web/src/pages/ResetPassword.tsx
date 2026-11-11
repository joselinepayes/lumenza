import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { AuthLayout } from '../components/auth/AuthLayout';
import { StatusPanel } from '../components/auth/StatusPanel';
import { Button, ButtonLink } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { ApiError, api } from '../lib/api';
import { useUrlToken } from '../lib/useUrlToken';

const schema = z
  .object({
    password: z.string().min(10, 'Mínimo 10 caracteres').refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Debe incluir letras y números'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Las contraseñas no coinciden' });
type Form = z.infer<typeof schema>;

const hints: Record<string, string> = {
  token_expired: 'Los enlaces duran 30 minutos. Solicita uno nuevo.',
  token_used: 'Este enlace ya se usó. Si necesitas cambiar tu contraseña otra vez, solicita uno nuevo.',
  token_invalid: 'No reconocemos este enlace. Solicita uno nuevo.',
};

export default function ResetPassword() {
  const token = useUrlToken();
  const check = useQuery({
    queryKey: ['reset-token', token],
    queryFn: () => api('/auth/reset-password/validate', { method: 'POST', body: { token } }),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(schema), mode: 'onTouched' });
  const m = useMutation({ mutationFn: (v: Form) => api('/auth/reset-password', { method: 'POST', body: { token, ...v } }) });

  const again = <ButtonLink to="/recuperar" size="lg">Solicitar un enlace nuevo</ButtonLink>;
  const wrap = (c: React.ReactNode) => <AuthLayout title="" subtitle="" footer={null} hideHeading>{c}</AuthLayout>;

  if (m.isSuccess)
    return wrap(
      <StatusPanel tone="success" title="Contraseña actualizada" actions={<ButtonLink to="/login" size="lg">Iniciar sesión</ButtonLink>}>
        Por seguridad cerramos tus sesiones anteriores. Entra con tu nueva contraseña.
      </StatusPanel>,
    );
  if (!token) return wrap(<StatusPanel tone="error" title="Enlace incompleto" actions={again}>Abre el enlace completo del correo que te enviamos.</StatusPanel>);
  if (check.isPending) return wrap(<StatusPanel tone="loading" title="Validando enlace…" />);
  if (check.isError) {
    const e = check.error;
    return wrap(<StatusPanel tone="error" title={e.message} actions={again}>{hints[e instanceof ApiError ? e.code : ''] ?? 'Inténtalo de nuevo.'}</StatusPanel>);
  }

  const failedCode = m.error instanceof ApiError ? m.error.code : '';
  if (failedCode.startsWith('token_')) return wrap(<StatusPanel tone="error" title={m.error!.message} actions={again}>{hints[failedCode]}</StatusPanel>);

  return (
    <AuthLayout title="Nueva contraseña" subtitle="Elige una contraseña segura que no uses en otro sitio." footer={<Link to="/login" className="font-medium text-accent-soft hover:underline">Volver a iniciar sesión</Link>}>
      <form onSubmit={handleSubmit((v) => m.mutate(v))} className="flex flex-col gap-4" noValidate>
        {m.error && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{m.error.message}</div>}
        <Field label="Nueva contraseña" type="password" autoComplete="new-password" hint="Mínimo 10 caracteres, con letras y números." error={errors.password?.message} {...register('password')} />
        <Field label="Confirmar contraseña" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
        <Button type="submit" size="lg" loading={m.isPending}>Guardar contraseña</Button>
      </form>
    </AuthLayout>
  );
}
