import { Bookmark, Camera, Grid3x3, Heart, ImagePlus, MessageCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FollowButton, UserRow } from '../components/layout/SuggestionsPanel';
import { usePublish } from '../components/layout/AppShell';
import { PhotoImage } from '../components/post/PhotoImage';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/ui/Feedback';
import { InfiniteSentinel } from '../components/ui/Infinite';
import { Modal } from '../components/ui/Modal';
import { ApiError, api } from '../lib/api';
import { flat, useProfile, useSaved, useUpdateProfile, useUserList, useUserPosts } from '../lib/social';
import { isViewable, type Post, type Profile as ProfileT } from '../lib/types';
import { ProcessingTile } from '../components/studio/ProcessingPanel';
import { useQueryClient } from '@tanstack/react-query';
import NotFound from './NotFound';

function Grid({ posts }: { posts: Post[] }) {
  return (
    <ul className="grid grid-cols-3 gap-1 sm:gap-2">
      {posts.map((p) => (
        <li key={p.id}>
          <Link to={`/p/${p.id}`} className="group relative block overflow-hidden rounded-sm sm:rounded-md" aria-label={`Abrir publicación${p.caption ? `: ${p.caption.slice(0, 60)}` : ''}`}>
            {isViewable(p) ? <PhotoImage src={p.photo.thumbUrl} width={4} height={5} alt="" className="transition-transform duration-300 group-hover:scale-[1.04]" /> : <ProcessingTile post={{ ...p, photo: { ...p.photo, width: 4, height: 5 } }} />}
            <span className="absolute inset-0 flex items-center justify-center gap-4 bg-black/50 text-sm font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="flex items-center gap-1"><Heart className="size-4 fill-white" />{p.likeCount}</span>
              <span className="flex items-center gap-1"><MessageCircle className="size-4 fill-white" />{p.commentCount}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PostsTab({ username, mine }: { username: string; mine: boolean }) {
  const q = useUserPosts(username);
  const publish = usePublish();
  const posts = flat(q.data);
  const more = useCallback(() => q.fetchNextPage(), [q]);
  if (q.isPending) return <div className="grid grid-cols-3 gap-1 sm:gap-2">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div>;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!posts.length) return <EmptyState icon={Camera} title="Sin publicaciones" action={mine ? <Button onClick={publish} icon={<ImagePlus className="size-4" />}>Publicar una fotografía</Button> : undefined}>{mine ? 'Comparte tu primera fotografía.' : 'Esta persona todavía no ha publicado.'}</EmptyState>;
  return <><Grid posts={posts} /><InfiniteSentinel hasNext={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onMore={more} onRetry={() => q.fetchNextPage()} /></>;
}

function SavedTab() {
  const q = useSaved(true);
  const posts = flat(q.data);
  const more = useCallback(() => q.fetchNextPage(), [q]);
  if (q.isPending) return <div className="grid grid-cols-3 gap-1 sm:gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="aspect-[4/5]" />)}</div>;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!posts.length) return <EmptyState icon={Bookmark} title="Nada guardado todavía">Guarda fotografías con el marcador para encontrarlas aquí. Solo tú puedes verlas.</EmptyState>;
  return <><Grid posts={posts} /><InfiniteSentinel hasNext={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onMore={more} onRetry={() => q.fetchNextPage()} /></>;
}

function UserListModal({ username, kind, onClose }: { username: string; kind: 'followers' | 'following'; onClose: () => void }) {
  const q = useUserList(username, kind, true);
  return (
    <Modal title={kind === 'followers' ? 'Seguidores' : 'Siguiendo'} onClose={onClose}>
      <div className="px-5 py-3">
        {q.isPending ? <Skeleton className="h-12" /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : q.data.items.length ? <ul>{q.data.items.map((u) => <UserRow key={u.id} u={u} />)}</ul> : <p className="py-8 text-center text-ink-2">{kind === 'followers' ? 'Aún no tiene seguidores.' : 'Aún no sigue a nadie.'}</p>}
      </div>
    </Modal>
  );
}

function EditProfileModal({ profile, onClose }: { profile: ProfileT; onClose: () => void }) {
  const update = useUpdateProfile(profile.username);
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [uploading, setUploading] = useState(false);
  const [avatarErr, setAvatarErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const pickAvatar = async (f?: File) => {
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setAvatarErr('Usa una imagen JPEG, PNG o WebP.');
    if (f.size > 15 * 1024 * 1024) return setAvatarErr('La imagen supera 15 MB.');
    setAvatarErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('avatar', f);
      const res = await fetch('/api/me/avatar', { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? 'No se pudo subir la imagen');
      qc.setQueryData(['profile', profile.username], data.profile);
      await qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
      toast('Foto de perfil actualizada');
    } catch (e) {
      setAvatarErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const current = (qc.getQueryData(['profile', profile.username]) as ProfileT | undefined) ?? profile;
  return (
    <Modal title="Editar perfil" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); update.mutate({ displayName: name, bio }, { onSuccess: () => { toast('Perfil actualizado'); onClose(); } }); }} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-4">
          <Avatar name={current.displayName} src={current.avatarUrl} size="lg" />
          <div>
            <Button type="button" variant="secondary" size="sm" loading={uploading} icon={<Camera className="size-4" />} onClick={() => file.current?.click()}>Cambiar foto</Button>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Seleccionar foto de perfil" onChange={(e) => pickAvatar(e.target.files?.[0])} />
            {avatarErr && <p role="alert" className="mt-1.5 text-xs text-danger">{avatarErr}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="ep-name" className="mb-1.5 block text-sm font-medium">Nombre</label>
          <input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="h-11 w-full rounded-md border border-line bg-surface px-3.5 focus:border-accent focus:outline-none focus:shadow-[var(--glow)]" />
        </div>
        <div>
          <label htmlFor="ep-bio" className="mb-1.5 block text-sm font-medium">Biografía</label>
          <textarea id="ep-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={4} className="w-full resize-none rounded-md border border-line bg-surface px-3.5 py-2.5 focus:border-accent focus:outline-none focus:shadow-[var(--glow)]" />
          <p className="mt-1 text-right text-xs text-ink-2">{bio.length}/300</p>
        </div>
        {update.error && <p role="alert" className="text-sm text-danger">{update.error.message}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={update.isPending}>Guardar</Button></div>
      </form>
    </Modal>
  );
}

export default function ProfilePage() {
  const { username = '' } = useParams();
  const q = useProfile(username.toLowerCase());
  const [tab, setTab] = useState<'posts' | 'saved'>('posts');
  const [modal, setModal] = useState<null | 'followers' | 'following' | 'edit'>(null);

  if (q.isPending) return <div className="px-4 sm:px-0"><div className="flex gap-6"><Skeleton className="size-28 rounded-full" /><div className="flex-1 space-y-3"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-64" /></div></div></div>;
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <NotFound inline /> : <ErrorState onRetry={() => q.refetch()} />;
  const p = q.data;
  const stat = (n: number, label: string, onClick?: () => void) => {
    const inner = <><span className="block text-lg font-medium leading-none">{n}</span><span className="text-sm text-ink-2">{label}</span></>;
    return onClick ? <button type="button" onClick={onClick} className="text-left transition-opacity hover:opacity-80">{inner}</button> : <div>{inner}</div>;
  };

  return (
    <div>
      <header className="px-4 pb-6 pt-4 sm:px-0 sm:pt-0">
        <div className="flex items-center gap-4 sm:gap-8">
          <Avatar name={p.displayName} src={p.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-3xl font-light tracking-tight sm:text-4xl">{p.displayName}</h1>
            <p className="truncate text-ink-2">@{p.username}</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 sm:gap-x-6">{stat(p.postCount, p.postCount === 1 ? 'publicación' : 'publicaciones')}{stat(p.followerCount, p.followerCount === 1 ? 'seguidor' : 'seguidores', () => setModal('followers'))}{stat(p.followingCount, 'siguiendo', () => setModal('following'))}</div>
          </div>
        </div>
        {p.bio && <p className="mt-5 max-w-prose whitespace-pre-line break-words leading-relaxed">{p.bio}</p>}
        <div className="mt-5">{p.isMe ? <Button variant="secondary" onClick={() => setModal('edit')}>Editar perfil</Button> : <FollowButton username={p.username} following={p.following} size="md" />}</div>
      </header>

      <div role="tablist" aria-label="Contenido del perfil" className="flex border-t border-line">
        <button role="tab" aria-selected={tab === 'posts'} onClick={() => setTab('posts')} className={`flex flex-1 items-center justify-center gap-2 border-t-2 py-3 text-xs uppercase tracking-[0.2em] transition-colors sm:flex-none sm:px-6 ${tab === 'posts' ? '-mt-px border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}><Grid3x3 className="size-4" /> Publicaciones</button>
        {p.isMe && <button role="tab" aria-selected={tab === 'saved'} onClick={() => setTab('saved')} className={`flex flex-1 items-center justify-center gap-2 border-t-2 py-3 text-xs uppercase tracking-[0.2em] transition-colors sm:flex-none sm:px-6 ${tab === 'saved' ? '-mt-px border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}><Bookmark className="size-4" /> Guardados</button>}
      </div>
      <div className="px-0.5 pt-1 sm:px-0 sm:pt-4">{tab === 'saved' && p.isMe ? <SavedTab /> : <PostsTab username={p.username} mine={p.isMe} />}</div>

      {modal === 'edit' && <EditProfileModal profile={p} onClose={() => setModal(null)} />}
      {(modal === 'followers' || modal === 'following') && <UserListModal username={p.username} kind={modal} onClose={() => setModal(null)} />}
    </div>
  );
}
