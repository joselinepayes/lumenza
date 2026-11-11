import { Check, Copy, Download, KeyRound, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { CodeInput } from '../components/auth/CodeInput';
import { Button } from '../components/ui/Button';
import { ErrorState, Skeleton, useToast } from '../components/ui/Feedback';
import { Field } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { groupSecret, useMfaDisable, useMfaEnable, useMfaRegenerate, useMfaSetup, useMfaStatus, type MfaSetup, type MfaStatus } from '../lib/mfa';

const dateFmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// ---------- Códigos de recuperación (se muestran UNA vez) ----------
function RecoveryCodes({ codes, onDone, doneLabel = 'Listo, ya los guardé' }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const text = `LUMENZA — códigos de recuperación\nCada código sirve una sola vez. Guárdalos en un lugar seguro.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast('Códigos copiados'); } catch { toast('No se pudo copiar', 'error'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'lumenza-codigos-de-recuperacion.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex gap-3 rounded-md border border-line bg-surface-2 p-3.5 text-sm text-ink-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        <p>Estos <strong className="font-medium text-ink">{codes.length} códigos</strong> te permiten entrar si pierdes tu teléfono. <strong className="font-medium text-ink">Solo se muestran ahora</strong>: guárdalos antes de continuar.</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 font-mono text-[15px] tracking-wider" aria-label="Códigos de recuperación" data-testid="recovery-codes">
        {codes.map((c) => <li key={c} className="rounded-md border border-line bg-surface-2 px-3 py-2 text-center">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={copy}>Copiar</Button>
        <Button type="button" variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={download}>Descargar .txt</Button>
      </div>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-4 accent-[var(--accent)]" />He guardado mis códigos de recuperación</label>
      <div className="flex justify-end"><Button disabled={!saved} onClick={onDone}>{doneLabel}</Button></div>
    </div>
  );
}

// ---------- Asistente de activación ----------
function EnableWizard({ status, onClose }: { status: MfaStatus; onClose: () => void }) {
  const toast = useToast();
  const setup = useMfaSetup();
  const enable = useMfaEnable();
  const [password, setPassword] = useState('');
  const [data, setData] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const start = (e: FormEvent) => { e.preventDefault(); setup.mutate(status.needsPassword ? password : undefined, { onSuccess: setData }); };
  const confirm = (v = code) => { if (v.length === 6 && !enable.isPending) enable.mutate(v, { onSuccess: (r) => setCodes(r.recoveryCodes), onError: () => setCode('') }); };

  if (codes) return <Modal title="Guarda tus códigos de recuperación" onClose={() => undefined}><RecoveryCodes codes={codes} onDone={() => { toast('Verificación en dos pasos activada'); onClose(); }} /></Modal>;

  return (
    <Modal title={data ? 'Escanea el código QR' : 'Activar verificación en dos pasos'} onClose={onClose}>
      {!data ? (
        <form onSubmit={start} className="flex flex-col gap-4 p-5">
          <p className="text-sm leading-relaxed text-ink-2">Necesitarás una aplicación de autenticación como <strong className="font-medium text-ink">Google Authenticator</strong> o <strong className="font-medium text-ink">Microsoft Authenticator</strong>.</p>
          {status.needsPassword ? (
            <Field label="Confirma tu contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          ) : (
            <p className="text-sm text-ink-2">Tu cuenta usa Google: verificaremos que tu sesión sea reciente.</p>
          )}
          {setup.error && <p role="alert" className="text-sm text-danger">{setup.error.message}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={setup.isPending} disabled={status.needsPassword && !password}>Continuar</Button></div>
        </form>
      ) : (
        <div className="flex flex-col gap-5 p-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>Abre tu aplicación de autenticación y añade una cuenta nueva.</li>
            <li>Escanea el código QR (o escribe la clave manualmente).</li>
            <li>Introduce el código de 6 dígitos que genera la aplicación.</li>
          </ol>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <img src={data.qrDataUrl} alt={`Código QR para añadir LUMENZA (${data.account}) a tu aplicación de autenticación`} width={176} height={176} className="size-44 shrink-0 rounded-md border border-line bg-white p-1" data-testid="mfa-qr" />
            <div className="min-w-0 text-sm">
              <p className="text-ink-2">¿No puedes escanear? Escribe esta clave:</p>
              <p className="mt-1 break-all rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-[15px] tracking-wider" data-testid="mfa-secret">{groupSecret(data.secret)}</p>
              <button type="button" className="mt-2 text-xs text-accent-soft hover:underline" onClick={async () => { try { await navigator.clipboard.writeText(data.secret); toast('Clave copiada'); } catch { toast('No se pudo copiar', 'error'); } }}>Copiar clave</button>
              <p className="mt-2 text-xs text-ink-2">Tipo: basado en tiempo (TOTP) · 6 dígitos · 30 s</p>
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="flex flex-col gap-4">
            <CodeInput label="Código de verificación" value={code} onChange={setCode} onComplete={confirm} error={enable.error?.message} autoFocus />
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={enable.isPending} disabled={code.length !== 6}>Verificar y activar</Button></div>
          </form>
        </div>
      )}
    </Modal>
  );
}

// ---------- Desactivar / regenerar (reautenticación + factor) ----------
function SecureAction({ kind, status, onClose }: { kind: 'disable' | 'regenerate'; status: MfaStatus; onClose: () => void }) {
  const toast = useToast();
  const disable = useMfaDisable();
  const regen = useMfaRegenerate();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [rc, setRc] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const m = kind === 'disable' ? disable : regen;
  const factor = useRecovery ? { recoveryCode: rc } : { code };
  const clearIfCode = (e: Error) => { if (e instanceof ApiError && e.code === 'invalid_code') setCode(''); }; // un error de contraseña no borra el código
  const ready = (!status.needsPassword || password) && (useRecovery ? rc.trim().length >= 10 : code.length === 6);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { password: status.needsPassword ? password : undefined, ...factor };
    if (kind === 'disable') disable.mutate(body, { onSuccess: () => { toast('Verificación en dos pasos desactivada'); onClose(); }, onError: clearIfCode });
    else regen.mutate(body, { onSuccess: (r) => setCodes(r.recoveryCodes), onError: clearIfCode });
  };

  if (codes) return <Modal title="Nuevos códigos de recuperación" onClose={() => undefined}><RecoveryCodes codes={codes} doneLabel="Listo" onDone={onClose} /></Modal>;
  return (
    <Modal title={kind === 'disable' ? 'Desactivar verificación en dos pasos' : 'Regenerar códigos de recuperación'} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-5">
        <p className="text-sm leading-relaxed text-ink-2">{kind === 'disable' ? 'Tu cuenta quedará protegida solo con la contraseña. Por seguridad confirma tu identidad.' : 'Se invalidarán todos los códigos anteriores. Confirma tu identidad.'}</p>
        {status.needsPassword && <Field label="Contraseña" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        {useRecovery
          ? <Field label="Código de recuperación" autoComplete="off" placeholder="XXXXX-XXXXX" value={rc} onChange={(e) => setRc(e.target.value)} />
          : <CodeInput label="Código de tu aplicación" value={code} onChange={setCode} />}
        <button type="button" className="self-start text-xs text-ink-2 hover:text-accent-soft" onClick={() => { setUseRecovery((v) => !v); m.reset(); }}>{useRecovery ? 'Usar el código de mi aplicación' : 'Usar un código de recuperación'}</button>
        {m.error && <p role="alert" className="text-sm text-danger">{m.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={m.isPending} disabled={!ready} className={kind === 'disable' ? '!bg-danger' : ''}>{kind === 'disable' ? 'Desactivar' : 'Regenerar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-5 py-4 first:border-t-0">
      <span className="grid size-9 place-items-center rounded-full border border-line text-accent">{icon}</span>
      <div className="min-w-0 flex-1 basis-56"><p className="font-medium">{title}</p><div className="text-sm text-ink-2">{children}</div></div>
      {action}
    </div>
  );
}

export default function SecuritySettings() {
  const { user } = useAuth();
  const q = useMfaStatus();
  const [modal, setModal] = useState<null | 'enable' | 'disable' | 'regenerate'>(null);
  const s = q.data;

  return (
    <div className="px-4 sm:px-0">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent-soft">Ajustes</p>
      <h1 className="font-display mt-1 text-4xl font-light tracking-tight">Seguridad</h1>
      <p className="mb-6 mt-1 text-ink-2">Protege tu cuenta de LUMENZA con una verificación adicional.</p>

      {user?.mfaRequired && !user.mfaEnabled && (
        <div role="alert" className="mb-5 flex gap-3 rounded-lg border border-accent/50 bg-surface-2 p-4 text-sm">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
          <p><strong className="font-medium">La verificación en dos pasos es obligatoria para administradores.</strong> Actívala para continuar usando LUMENZA.</p>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-line bg-surface" aria-labelledby="mfa-title">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <h2 id="mfa-title" className="font-display text-xl font-light">Verificación en dos pasos (TOTP)</h2>
          {s && (
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${s.enabled ? 'border-success/50 text-success' : 'border-line text-ink-2'}`} data-testid="mfa-badge">
              {s.enabled ? <ShieldCheck className="size-3.5" aria-hidden /> : <ShieldOff className="size-3.5" aria-hidden />}{s.enabled ? 'Activada' : 'Desactivada'}
            </span>
          )}
        </header>

        {q.isPending ? <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          : q.isError ? <ErrorState onRetry={() => q.refetch()} />
          : !s!.available ? <p className="p-5 text-sm text-ink-2">La verificación en dos pasos no está configurada en este entorno (falta la clave de cifrado del servidor).</p>
          : !s!.enabled ? (
            <Row icon={<KeyRound className="size-4" strokeWidth={1.75} />} title="Añade una capa extra de protección" action={<Button onClick={() => setModal('enable')}>Activar</Button>}>
              Al iniciar sesión te pediremos, además de tu contraseña, un código temporal de tu aplicación (Google Authenticator, Microsoft Authenticator…). También se exige al entrar con Google.
            </Row>
          ) : (
            <>
              <Row icon={<ShieldCheck className="size-4" strokeWidth={1.75} />} title="Protección activa">Activada el {dateFmt(s!.enabledAt)}. Te pedimos el código en cada inicio de sesión, también con Google.</Row>
              <Row icon={<KeyRound className="size-4" strokeWidth={1.75} />} title="Códigos de recuperación" action={<Button variant="secondary" size="sm" onClick={() => setModal('regenerate')}>Regenerar</Button>}>
                <span data-testid="recovery-remaining">{s!.recoveryRemaining} de 10 disponibles</span>{s!.recoveryRemaining <= 3 && <span className="text-danger"> · quedan pocos: genera nuevos</span>}
              </Row>
              <Row icon={<ShieldOff className="size-4" strokeWidth={1.75} />} title="Desactivar verificación en dos pasos" action={s!.requiredForRole ? undefined : <Button variant="secondary" size="sm" onClick={() => setModal('disable')}>Desactivar</Button>}>
                {s!.requiredForRole ? 'No se puede desactivar: es obligatoria para tu rol.' : 'Requiere tu contraseña y un código válido.'}
              </Row>
            </>
          )}
      </section>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-2"><Check className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />Si pierdes el teléfono y los códigos de recuperación no podrás recuperar el acceso por tu cuenta; guárdalos en un lugar seguro.</p>

      {s && modal === 'enable' && <EnableWizard status={s} onClose={() => setModal(null)} />}
      {s && (modal === 'disable' || modal === 'regenerate') && <SecureAction kind={modal} status={s} onClose={() => setModal(null)} />}
    </div>
  );
}
