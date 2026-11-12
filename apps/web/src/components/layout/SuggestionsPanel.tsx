import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useTrendingTags } from '../../lib/notifications';
import { useFollow, useSuggestions } from '../../lib/social';
import type { UserListItem } from '../../lib/types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Feedback';

export function FollowButton({ username, following, requested = false, isPrivate = false, size = 'sm' }: { username: string; following: boolean; requested?: boolean; isPrivate?: boolean; size?: 'sm' | 'md' }) {
  const m = useFollow(username);
  return (
    <Button size={size} variant={following || requested ? 'secondary' : 'primary'} loading={m.isPending} onClick={() => m.mutate(!(following || requested))} aria-pressed={following || requested} aria-label={`${following ? 'Dejar de seguir a' : 'Seguir a'} ${username}`}>
      {following ? 'Siguiendo' : requested ? 'Solicitado' : isPrivate ? 'Solicitar' : 'Seguir'}
    </Button>
  );
}

export function UserRow({ u }: { u: UserListItem }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Link to={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={u.displayName} src={u.avatarUrl} size="sm" />
        <span className="min-w-0"><span className="block truncate text-sm font-medium leading-tight">{u.displayName}</span><span className="block truncate text-xs text-ink-2">{u.reason ?? `@${u.username}`}</span></span>
      </Link>
      {!u.isMe && <FollowButton username={u.username} following={u.following} requested={u.requested} isPrivate={u.isPrivate} />}
    </li>
  );
}

export function SuggestionsPanel() {
  const { user } = useAuth();
  const { data, isPending } = useSuggestions();
  const tags = useTrendingTags();
  return (
    <section>
      <Link to={`/u/${user?.username}`} className="mb-6 flex items-center gap-3">
        <Avatar name={user?.displayName ?? '?'} src={user?.avatarUrl ?? null} size="md" />
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{user?.displayName}</span><span className="block truncate text-xs text-ink-2">@{user?.username}</span></span>
      </Link>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-ink-2">Miradas para seguir</h2>
      {isPending ? <div className="space-y-3 py-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
        : data?.items.length ? <ul>{data.items.map((u) => <UserRow key={u.id} u={u} />)}</ul>
        : <p className="py-2 text-sm text-ink-2">Aún no hay otras personas con publicaciones.</p>}
      {tags.data && tags.data.items.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-[0.22em] text-ink-2">En tendencia</h2>
          <ul className="flex flex-wrap gap-2">
            {tags.data.items.map((t) => <li key={t.tag}><Link to={`/explorar?tag=${t.tag}`} className="inline-flex rounded-md border border-line px-2.5 py-1 text-sm text-accent-soft transition-colors hover:border-accent" title={`${t.posts} publicaciones`}>#{t.tag}</Link></li>)}
          </ul>
        </>
      )}
    </section>
  );
}
