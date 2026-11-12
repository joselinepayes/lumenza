import { ArrowLeft, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Caption, PostActions, PostMenu, PostMeta } from '../components/post/PostCard';
import { Studio } from '../components/studio/Studio';
import { Avatar } from '../components/ui/Avatar';
import { ErrorState, Skeleton } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { ApiError } from '../lib/api';
import { flat, relativeTime, useAddComment, useComments, useDeleteComment, usePost } from '../lib/social';
import { usePageTitle } from '../lib/title';
import type { Post } from '../lib/types';
import NotFound from './NotFound';

function Comments({ post }: { post: Post }) {
  const q = useComments(post.id);
  const add = useAddComment(post);
  const del = useDeleteComment(post.id);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const items = flat(q.data);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setErr(null);
    add.mutate(text, { onSuccess: () => setText(''), onError: (er) => setErr(er instanceof ApiError ? er.message : 'No se pudo comentar') });
  };

  return (
    <section aria-label="Comentarios" className="flex min-h-0 flex-1 flex-col">
      <ul className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
        {q.isPending && <Skeleton className="h-10" />}
        {q.isError && <li><ErrorState message="No pudimos cargar los comentarios" onRetry={() => q.refetch()} /></li>}
        {!q.isPending && !q.isError && items.length === 0 && <li className="text-sm text-ink-2">Aún no hay comentarios. Empieza la conversación.</li>}
        {items.map((c) => (
          <li key={c.id} className="group flex gap-3">
            <Link to={`/u/${c.author.username}`}><Avatar name={c.author.displayName} src={c.author.avatarUrl} size="sm" /></Link>
            <div className="min-w-0 flex-1 text-sm">
              <p className="break-words leading-relaxed"><Link to={`/u/${c.author.username}`} className="mr-1.5 font-medium hover:underline">{c.author.username}</Link>{c.body}</p>
              <p className="mt-0.5 text-xs text-ink-2">{relativeTime(c.createdAt)}</p>
            </div>
            {c.canDelete && (
              <button type="button" onClick={() => del.mutate(c.id)} aria-label="Eliminar comentario" className="grid size-8 shrink-0 place-items-center rounded-md text-ink-2 opacity-100 transition hover:bg-surface-2 hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"><Trash2 className="size-4" strokeWidth={1.75} /></button>
            )}
          </li>
        ))}
        {q.hasNextPage && <li><button className="text-sm text-accent-soft hover:underline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Cargando…' : 'Ver más comentarios'}</button></li>}
      </ul>
      <form onSubmit={submit} className="border-t border-line pt-3">
        <div className="flex items-center gap-2">
          <label htmlFor="new-comment" className="sr-only">Añadir comentario</label>
          <input ref={input} id="new-comment" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Añade un comentario…" className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm placeholder:text-ink-2/70 focus:border-accent focus:outline-none focus:shadow-[var(--glow)]" />
          <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>Publicar</Button>
        </div>
        {err && <p role="alert" className="mt-1.5 text-xs text-danger">{err}</p>}
      </form>
    </section>
  );
}

export default function PostPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const q = usePost(id);
  // Título sin texto de la publicación (puede ser de acceso restringido): solo el nombre de quien publica, ya visible en la página
  usePageTitle(q.isError ? (q.error instanceof ApiError && q.error.status === 404 ? 'Publicación no disponible' : 'Publicación') : q.data ? `Fotografía de ${q.data.author.displayName}` : 'Publicación');
  const loc = useLocation();
  useEffect(() => { if (loc.hash === '#studio' && q.data) document.getElementById('studio')?.scrollIntoView({ block: 'start' }); }, [loc.hash, q.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusComment = () => document.getElementById('new-comment')?.focus();

  if (q.isPending) return <div className="px-4 sm:px-0"><Skeleton className="mb-4 h-8 w-32" /><Skeleton className="aspect-[4/5] w-full" /></div>;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <NotFound inline /> : <ErrorState onRetry={() => q.refetch()} />;
  const post = q.data;

  return (
    <article className="px-0 sm:px-0" aria-label="Publicación">
      <div className="mb-3 flex items-center px-4 sm:px-0">
        <button type="button" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/inicio'))} className="-ml-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"><ArrowLeft className="size-4" /> Volver</button>
      </div>
      <div className="overflow-hidden border-y border-line sm:rounded-lg sm:border sm:bg-surface">
        <Studio post={post} />
        <div className="border-t border-line px-4 py-4 sm:px-6">
          <header className="mb-4 flex items-center gap-3">
            <Link to={`/u/${post.author.username}`} className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="md" />
              <span className="min-w-0"><span className="block truncate font-medium leading-tight">{post.author.displayName}</span><span className="block truncate text-sm text-ink-2">@{post.author.username}</span></span>
            </Link>
            <PostMeta post={post} />
            <PostMenu post={post} onDeleted={() => nav('/inicio', { replace: true })} />
          </header>
          <Caption post={post} />
          <div className="mt-4 flex items-center justify-between border-t border-line pt-2">
            <PostActions post={post} onComment={focusComment} />
          </div>
          <p className="text-sm font-medium" aria-live="polite">{post.likeCount === 1 ? '1 me gusta' : `${post.likeCount} me gusta`}</p>
          <div className="mt-4 border-t border-line"><Comments post={post} /></div>
        </div>
      </div>
    </article>
  );
}
