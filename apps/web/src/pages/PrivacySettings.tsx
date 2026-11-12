import { Bell, Lock, UserCheck, Volume2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { ErrorState, Skeleton, useToast } from '../components/ui/Feedback';
import { Switch } from '../components/ui/Switch';
import { useFollowRequests, useResolveRequest, useSettings, useUpdateSettings } from '../lib/notifications';
import { relativeTime } from '../lib/social';
import { playSound, setSoundEnabled, soundEnabled } from '../lib/sound';
import type { Settings } from '../lib/types';
import { usePageTitle } from '../lib/title';

export function SettingsTabs() {
  const tab = ({ isActive }: { isActive: boolean }) => `-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${isActive ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`;
  return (
    <nav aria-label="Secciones de ajustes" className="mb-6 flex gap-1 border-b border-line">
      <NavLink to="/ajustes/privacidad" className={tab}>Privacidad y avisos</NavLink>
      <NavLink to="/ajustes/seguridad" className={tab}>Seguridad</NavLink>
    </nav>
  );
}

function Row({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action: ReactNode }) {
  return (
    <div className="flex items-center gap-x-4 border-t border-line px-5 py-4 first:border-t-0">
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-accent">{icon}</span>
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p>{children && <div className="text-sm text-ink-2">{children}</div>}</div>
      {action}
    </div>
  );
}

function Requests() {
  const q = useFollowRequests();
  const resolve = useResolveRequest();
  if (q.isPending) return <Skeleton className="h-14" />;
  if (!q.data?.items.length) return <p className="px-5 py-4 text-sm text-ink-2">No tienes solicitudes pendientes.</p>;
  return (
    <ul className="divide-y divide-line">
      {q.data.items.map((u) => (
        <li key={u.id} className="flex items-center gap-3 px-5 py-3">
          <Link to={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={u.displayName} src={u.avatarUrl} size="sm" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{u.displayName}</span><span className="block truncate text-xs text-ink-2">@{u.username} · {relativeTime(u.requestedAt)}</span></span>
          </Link>
          <Button size="sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ username: u.username, accept: true })}>Aceptar</Button>
          <Button size="sm" variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ username: u.username, accept: false })}>Rechazar</Button>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacySettings() {
  usePageTitle('Privacidad');
  const q = useSettings();
  const upd = useUpdateSettings();
  const toast = useToast();
  const [sound, setSound] = useState(soundEnabled());
  const s = q.data;

  const setPrefs = (k: keyof Settings['notifPrefs'], v: boolean) => upd.mutate({ notifPrefs: { [k]: v } }, { onError: () => toast('No se pudo guardar', 'error') });
  const setPrivate = (v: boolean) => upd.mutate({ isPrivate: v }, { onSuccess: () => toast(v ? 'Tu perfil ahora es privado' : 'Tu perfil ahora es público'), onError: () => toast('No se pudo guardar', 'error') });

  return (
    <div className="px-4 sm:px-0">
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-accent-soft">Ajustes</p>
      <h1 className="font-display mt-1 text-4xl font-light tracking-tight">Privacidad y avisos</h1>
      <p className="mb-6 mt-1 text-ink-2">Decide quién te sigue y qué te avisamos.</p>
      <SettingsTabs />

      {q.isPending ? <Skeleton className="h-40" /> : q.isError || !s ? <ErrorState onRetry={() => q.refetch()} /> : (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="priv" className="overflow-hidden rounded-lg border border-line bg-surface">
            <h2 id="priv" className="sr-only">Privacidad</h2>
            <Row icon={<Lock className="size-4" strokeWidth={1.75} />} title="Perfil privado" action={<Switch checked={s.isPrivate} onChange={setPrivate} label="Perfil privado" disabled={upd.isPending} />}>
              {s.isPrivate ? 'Solo quienes aceptes pueden ver tus fotografías y seguidores.' : 'Cualquier persona puede ver tus fotografías públicas y seguirte.'}
            </Row>
          </section>

          {s.isPrivate && (
            <section aria-labelledby="req" className="overflow-hidden rounded-lg border border-line bg-surface">
              <h2 id="req" className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs font-medium uppercase tracking-[0.2em] text-ink-2"><UserCheck className="size-4" aria-hidden />Solicitudes de seguimiento {s.pendingRequests > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-on-accent">{s.pendingRequests}</span>}</h2>
              <Requests />
            </section>
          )}

          <section aria-labelledby="av" className="overflow-hidden rounded-lg border border-line bg-surface">
            <h2 id="av" className="sr-only">Avisos</h2>
            {([['like', 'Me gusta', 'Cuando alguien da me gusta a una fotografía tuya'], ['comment', 'Comentarios', 'Cuando alguien comenta una fotografía tuya'], ['follow', 'Nuevos seguidores', 'Cuando alguien empieza a seguirte'], ['follow_request', 'Solicitudes de seguimiento', 'Cuando alguien pide seguirte (perfil privado)']] as const).map(([k, title, desc]) => (
              <Row key={k} icon={<Bell className="size-4" strokeWidth={1.75} />} title={title} action={<Switch checked={s.notifPrefs[k]} onChange={(v) => setPrefs(k, v)} label={title} />}>{desc}</Row>
            ))}
            <Row icon={<Volume2 className="size-4" strokeWidth={1.75} />} title="Sonidos" action={<Switch checked={sound} onChange={(v) => { setSound(v); setSoundEnabled(v); if (v) playSound('notify', true); }} label="Sonidos de avisos" />}>
              Un tono suave al recibir avisos y nuevas fotografías. Se guarda solo en este dispositivo.
            </Row>
          </section>
        </div>
      )}
    </div>
  );
}
