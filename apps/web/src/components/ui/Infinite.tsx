import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ErrorState } from './Feedback';

/** Carga incremental real: pide la siguiente página cuando el centinela entra en pantalla. */
export function InfiniteSentinel({ hasNext, loading, error, onMore, onRetry }: { hasNext: boolean; loading: boolean; error: boolean; onMore: () => void; onRetry: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasNext || loading || error || !ref.current) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && onMore(), { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [hasNext, loading, error, onMore]);
  if (error) return <ErrorState message="No pudimos cargar más" onRetry={onRetry} />;
  return (
    <div ref={ref} className="grid h-16 place-items-center" aria-hidden={!loading}>
      {loading && <Loader2 className="size-5 animate-spin text-ink-2" aria-label="Cargando más" />}
    </div>
  );
}
