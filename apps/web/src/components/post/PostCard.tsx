import { Bookmark, Download, Globe2, Heart, Link2, Lock, MessageCircle, MoreHorizontal, Send, Trash2, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { relativeTime, useAddComment, useDeletePost, useProcessingSync, useToggle } from '../../lib/social';
import { categoryLabel, isViewable, type Post } from '../../lib/types';
import { ProcessingTile } from '../studio/ProcessingPanel';
import { LogoMark } from '../ui/Logo';
import { Avatar } from '../ui/Avatar';
import { useToast } from '../ui/Feedback';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Menu, type MenuItem } from '../ui/Menu';
import { PhotoImage } from './PhotoImage';

export async function copyPostLink(id: string, toast: (t: string, tone?: 'ok' | 'error') => void) {
  const url = `${window.location.origin}/p/${id}`;
  try {
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ url, title: 'LUMENZA' });
    else {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado');
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') toast('No se pudo copiar el enlace', 'error');
  }
}

const visIcon = { public: Globe2, followers: Users, private: Lock } as const;
const visLabel = { public: 'Pública', followers: 'Solo seguidores', private: 'Solo tú' } as const;

export function PostActions({ post, onComment }: { post: Post; onComment?: () => void }) {
  const like = useToggle(post, 'like');
  const save = useToggle(post, 'save');
  const toast = useToast();
  const btn = 'grid size-10 place-items-center rounded-md text-ink transition-[background,transform] duration-150 hover:bg-surface-2 active:scale-90';
  return (
    <div className="flex items-center gap-0.5 -ml-2">
      <button type="button" className={btn} onClick={() => like.mutate()} aria-pressed={post.liked} aria-label={post.liked ? 'Quitar me gusta' : 'Me gusta'}>
        <Heart className={`size-[22px] transition-colors ${post.liked ? 'fill-accent text-accent' : ''}`} strokeWidth={1.75} />
      </button>
      {onComment ? (
        <button type="button" className={btn} onClick={onComment} aria-label="Comentar"><MessageCircle className="size-[22px]" strokeWidth={1.75} /></button>
      ) : (
        <Link to={`/p/${post.id}`} className={btn} aria-label="Ver comentarios"><MessageCircle className="size-[22px]" strokeWidth={1.75} /></Link>
      )}
      <button type="button" className={btn} onClick={() => copyPostLink(post.id, toast)} aria-label="Compartir enlace"><Send className="size-[21px]" strokeWidth={1.75} /></button>
      <button type="button" className={`${btn} ml-auto`} onClick={() => save.mutate()} aria-pressed={post.saved} aria-label={post.saved ? 'Quitar de guardados' : 'Guardar'}>
        <Bookmark className={`size-[22px] ${post.saved ? 'fill-accent text-accent' : ''}`} strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function PostMenu({ post, onDeleted }: { post: Post; onDeleted?: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const del = useDeletePost();
  const [confirm, setConfirm] = useState(false);
  const items: MenuItem[] = [
    { label: 'Abrir publicación', icon: <MessageCircle className="size-4" />, onSelect: () => nav(`/p/${post.id}`) },
    { label: 'Copiar enlace', icon: <Link2 className="size-4" />, onSelect: () => copyPostLink(post.id, toast) },
    { label: 'Ver perfil', icon: <Users className="size-4" />, onSelect: () => nav(`/u/${post.author.username}`) },
  ];
  if (post.isOwner || post.allowDownload) items.push({ label: 'Descargar original', icon: <Download className="size-4" />, onSelect: () => { window.location.href = `/api/media/photo/${post.photo.id}/original?download=1`; } });
  if (post.isOwner) items.push({ label: 'Eliminar', icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirm(true) });
  return (
    <>
      <Menu label="Más acciones" trigger={<MoreHorizontal className="size-5" strokeWidth={1.75} />} items={items} />
      {confirm && (
        <Modal title="Eliminar publicación" onClose={() => setConfirm(false)}>
          <div className="p-5">
            <p className="text-ink-2">Se eliminarán la fotografía, sus comentarios y reacciones. Esta acción no se puede deshacer.</p>
            {del.error && <p role="alert" className="mt-3 text-sm text-danger">{del.error.message}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
              <Button loading={del.isPending} className="!bg-danger" onClick={() => del.mutate(post.id, { onSuccess: () => { setConfirm(false); toast('Publicación eliminada'); onDeleted?.(); } })}>Eliminar</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function PostMeta({ post }: { post: Post }) {
  const V = visIcon[post.visibility];
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-2">
      <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString('es')}>{relativeTime(post.createdAt)}</time>
      {post.visibility !== 'public' && (<><span aria-hidden>·</span><V className="size-3" aria-hidden /><span>{visLabel[post.visibility]}</span></>)}
    </span>
  );
}

export function Caption({ post }: { post: Post }) {
  return (
    <>
      {post.caption && (
        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">
          <Link to={`/u/${post.author.username}`} className="mr-1.5 font-medium hover:underline">{post.author.username}</Link>
          {post.caption}
        </p>
      )}
      {(post.tags.length > 0 || post.category) && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {post.category && <Link to={`/explorar?cat=${post.category}`} className="text-ink-2 hover:text-ink">{categoryLabel(post.category)}</Link>}
          {post.tags.map((t) => <Link key={t} to={`/explorar?tag=${t}`} className="text-accent-soft hover:underline">#{t}</Link>)}
        </p>
      )}
    </>
  );
}

export function PostCard({ post, eager = false }: { post: Post; eager?: boolean }) {
  const like = useToggle(post, 'like');
  const [burst, setBurst] = useState(false);
  const add = useAddComment(post);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useProcessingSync(post); // mientras se procesa, consulta el estado real y actualiza la tarjeta sin recargar
  const viewable = isViewable(post);
  const studioCount = post.variants.filter((v) => v.kind.includes('_')).length;

  const doubleLike = () => {
    if (!post.liked) like.mutate();
    setBurst(true);
    setTimeout(() => setBurst(false), 700);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setErr(null);
    add.mutate(text, { onSuccess: () => setText(''), onError: (er) => setErr(er instanceof ApiError ? er.message : 'No se pudo comentar') });
  };

  return (
    <article className="rise border-b border-line pb-6 sm:rounded-lg sm:border sm:bg-surface sm:pb-5" aria-label={`Publicación de ${post.author.username}`}>
      <header className="flex items-center gap-3 px-4 py-3 sm:px-5">
        <Link to={`/u/${post.author.username}`} className="flex min-w-0 flex-1 items-center gap-3" aria-label={`Perfil de ${post.author.displayName}`}>
          <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium leading-tight">{post.author.displayName}</span>
            <span className="block truncate text-xs text-ink-2">@{post.author.username}</span>
          </span>
        </Link>
        <PostMeta post={post} />
        <PostMenu post={post} />
      </header>

      {viewable ? (
        <>
          <div className="relative cursor-pointer select-none" onDoubleClick={doubleLike}>
            <PhotoImage src={post.photo.displayUrl} width={post.photo.width} height={post.photo.height} alt={post.caption ? `Fotografía: ${post.caption.slice(0, 120)}` : `Fotografía de ${post.author.displayName}`} eager={eager} className="sm:border-y sm:border-line" />
            {burst && <Heart className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 fill-white text-white drop-shadow-lg" style={{ animation: 'pop 700ms var(--ease) forwards' }} aria-hidden />}
          </div>
          {studioCount > 0 && (
            <Link to={`/p/${post.id}#studio`} className="mx-4 mt-3 inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 transition-[border-color,color] duration-200 hover:border-accent hover:text-ink sm:mx-5" aria-label={`Abrir LUMENZA Studio: ${studioCount} versiones`}>
              <LogoMark size={16} /> LUMENZA Studio · {studioCount} versiones
            </Link>
          )}
        </>
      ) : (
        <Link to={`/p/${post.id}`} aria-label="Ver el estado del procesamiento" className="block"><ProcessingTile post={post} className="sm:border-y sm:border-line" /></Link>
      )}

      <div className="px-4 pt-2 sm:px-5">
        <PostActions post={post} />
        <p className="mb-2 text-sm font-medium" aria-live="polite">{post.likeCount === 1 ? '1 me gusta' : `${post.likeCount} me gusta`}</p>
        <Caption post={post} />
        {post.commentCount > 0 && (
          <Link to={`/p/${post.id}`} className="mt-3 block text-sm text-ink-2 hover:text-ink">
            {post.commentCount === 1 ? 'Ver 1 comentario' : `Ver los ${post.commentCount} comentarios`}
          </Link>
        )}
        <form onSubmit={submit} className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <label className="sr-only" htmlFor={`c-${post.id}`}>Añadir comentario</label>
          <input id={`c-${post.id}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Añade un comentario…" className="h-9 min-w-0 flex-1 bg-transparent text-sm placeholder:text-ink-2/70 focus:outline-none" />
          <button type="submit" disabled={!text.trim() || add.isPending} className="text-sm font-medium text-accent-soft transition-opacity disabled:opacity-40">Publicar</button>
        </form>
        {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
      </div>
    </article>
  );
}
