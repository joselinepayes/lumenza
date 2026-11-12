import { Bell, BellOff, CheckCheck, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { InfiniteSentinel } from '../components/ui/Infinite';
import { notifText, useMarkRead, useNotifications, useResolveRequest } from '../lib/notifications';
import { flat, relativeTime } from '../lib/social';
import { playSound, setSoundEnabled, soundEnabled } from '../lib/sound';
import type { Notif } from '../lib/types';
import { usePageTitle } from '../lib/title';

function Item({ n, fresh }: { n: Notif; fresh: boolean }) {
  const resolve = useResolveRequest();
  const to = n.postId ? `/p/${n.postId}` : n.actor ? `/u/${n.actor.username}` : '/inicio';
  return (
    <li className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${fresh ? 'bg-surface-2' : ''}`}>
      <Link to={n.actor ? `/u/${n.actor.username}` : to} aria-label={n.actor ? `Perfil de ${n.actor.displayName}` : 'Aviso'}>
        <Avatar name={n.actor?.displayName ?? 'L'} src={n.actor?.avatarUrl ?? null} size="sm" />
      </Link>
      <Link to={to} className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{notifText(n)}</p>
        <p className="mt-0.5 text-xs text-ink-2"><time dateTime={n.createdAt}>{relativeTime(n.createdAt)}</time>{fresh && <span className="ml-2 text-accent-soft">Nueva</span>}</p>
      </Link>
      {n.type === 'follow_request' && n.actor && n.pending ? (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" loading={resolve.isPending} onClick={() => resolve.mutate({ username: n.actor!.username, accept: true })}>Aceptar</Button>
          <Button size="sm" variant="secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ username: n.actor!.username, accept: false })}>Rechazar</Button>
        </div>
      ) : n.type === 'follow_request' ? (
        <span className="shrink-0 text-xs text-ink-2">{n.following ? 'Aceptada' : 'Resuelta'}</span>
      ) : n.thumbUrl ? (
        <Link to={to} className="shrink-0" aria-label="Abrir fotografía"><img src={n.thumbUrl} alt="" className="size-11 rounded-md border border-line object-cover" loading="lazy" /></Link>
      ) : null}
    </li>
  );
}

export default function Notifications() {
  usePageTitle('Notificaciones');
  const q = useNotifications();
  const mark = useMarkRead();
  const [sound, setSound] = useState(soundEnabled());
  const items = flat(q.data);
  // Se recuerda cuáles estaban sin leer al abrir la página para resaltarlas aunque se marquen como leídas enseguida
  const fresh = useRef<Set<string>>(new Set());
  items.forEach((n) => { if (!n.read) fresh.current.add(n.id); });
  const more = useCallback(() => q.fetchNextPage(), [q]);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    if (!q.isSuccess || unread === 0) return;
    const t = setTimeout(() => mark.mutate(undefined), 2500);
    return () => clearTimeout(t);
  }, [q.isSuccess, unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) playSound('notify', true);
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-3 px-4 pt-4 sm:px-0 sm:pt-0">
        <div>
          <h1 className="font-display text-4xl font-light tracking-tight">Avisos</h1>
          <p className="mb-5 mt-1 text-ink-2">Lo que pasa con tus fotografías y tu perfil.</p>
        </div>
        <div className="mb-5 flex gap-1">
          <button type="button" onClick={toggleSound} aria-pressed={sound} aria-label={sound ? 'Silenciar sonidos' : 'Activar sonidos'} title={sound ? 'Sonidos activados' : 'Sonidos silenciados'} className="grid size-10 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
            {sound ? <Volume2 className="size-5" strokeWidth={1.75} /> : <VolumeX className="size-5" strokeWidth={1.75} />}
          </button>
          <button type="button" disabled={unread === 0 || mark.isPending} onClick={() => mark.mutate(undefined)} aria-label="Marcar todo como leído" title="Marcar todo como leído" className="grid size-10 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40">
            <CheckCheck className="size-5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {q.isPending ? (
        <div className="space-y-2 px-4 sm:px-0">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={BellOff} title="Todo en calma">Cuando alguien te siga, comente o dé me gusta a tus fotografías, lo verás aquí al instante.</EmptyState>
      ) : (
        <div className="overflow-hidden border-y border-line sm:rounded-lg sm:border sm:bg-surface">
          <ul className="divide-y divide-line">{items.map((n) => <Item key={n.id} n={n} fresh={fresh.current.has(n.id)} />)}</ul>
          <InfiniteSentinel hasNext={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onMore={more} onRetry={() => q.fetchNextPage()} />
        </div>
      )}
      <p className="sr-only" aria-live="polite"><Bell aria-hidden /> {unread} avisos sin leer</p>
    </div>
  );
}
