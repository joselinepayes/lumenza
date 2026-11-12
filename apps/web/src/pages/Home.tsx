import { Compass, ImagePlus } from 'lucide-react';
import { useCallback } from 'react';
import { VerifyBanner } from '../components/auth/VerifyBanner';
import { usePublish } from '../components/layout/AppShell';
import { NewContentPill } from '../components/layout/Live';
import { PostCard } from '../components/post/PostCard';
import { Button, ButtonLink } from '../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/Feedback';
import { InfiniteSentinel } from '../components/ui/Infinite';
import { flat, useFeed } from '../lib/social';

export function PostSkeleton() {
  return (
    <div className="border-b border-line pb-6 sm:rounded-lg sm:border sm:bg-surface" aria-hidden="true">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-5"><Skeleton className="size-9 rounded-full" /><Skeleton className="h-4 w-32" /></div>
      <Skeleton className="aspect-[4/5] w-full !rounded-none" />
      <div className="space-y-2 px-4 pt-4 sm:px-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-3/4" /></div>
    </div>
  );
}

export default function Feed() {
  const q = useFeed();
  const publish = usePublish();
  const posts = flat(q.data);
  const more = useCallback(() => q.fetchNextPage(), [q]);

  return (
    <div className="px-0">
      <h1 className="sr-only">Inicio</h1>
      <div className="px-4 pt-4 sm:px-0 sm:pt-0"><VerifyBanner /></div>
      <NewContentPill kind="feed" one="publicación" many="publicaciones" />
      {q.isPending ? (
        <div className="flex flex-col gap-6">{[0, 1].map((i) => <PostSkeleton key={i} />)}</div>
      ) : q.isError ? (
        <ErrorState message="No pudimos cargar tu galería" onRetry={() => q.refetch()} />
      ) : posts.length === 0 ? (
        <EmptyState icon={ImagePlus} title="Tu galería está en blanco" action={<div className="flex flex-wrap justify-center gap-3"><Button onClick={publish}>Publicar una fotografía</Button><ButtonLink to="/explorar" variant="secondary" icon={<Compass className="size-4" />}>Explorar</ButtonLink></div>}>
          Aquí verás las fotografías de quienes sigues y las tuyas. Publica la primera o descubre otras miradas.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6">
          {posts.map((p, i) => <PostCard key={p.id} post={p} eager={i === 0} />)}
          <InfiniteSentinel hasNext={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} error={q.isFetchNextPageError} onMore={more} onRetry={() => q.fetchNextPage()} />
          {!q.hasNextPage && <p className="pb-4 text-center text-sm text-ink-2">Has visto todas las publicaciones.</p>}
        </div>
      )}
    </div>
  );
}
