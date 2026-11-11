import { Check, Loader2, RefreshCcw, TriangleAlert } from 'lucide-react';
import { useReprocess } from '../../lib/social';
import { STEPS, stageText } from '../../lib/studio';
import type { Post } from '../../lib/types';
import { Button } from '../ui/Button';
import { LogoMark } from '../ui/Logo';

/** Estado REAL del worker: porcentaje y etapa vienen de PostgreSQL (se actualizan por consulta periódica). */
export function ProcessingPanel({ post }: { post: Post }) {
  const { status, progress, stage, error, attempts } = post.processing;
  const retry = useReprocess(post.id);
  const failed = status === 'failed';
  const active = status === 'pending' || status === 'processing';

  return (
    <div className="grid grid-cols-1 gap-0 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div
        className="relative grid min-h-[220px] min-w-0 place-items-center overflow-hidden sm:min-h-[380px]"
        style={{ background: 'radial-gradient(90% 80% at 30% 20%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%), var(--surface-2)' }}
        role="img"
        aria-label="Fotografía en procesamiento"
      >
        <div className="text-center">
          <div className={`mx-auto mb-4 w-fit ${active ? 'motion-safe:animate-[spin_6s_linear_infinite]' : ''}`}><LogoMark size={failed ? 44 : 56} /></div>
          {failed ? (
            <TriangleAlert className="mx-auto size-6 text-danger" strokeWidth={1.5} aria-hidden />
          ) : (
            <p className="font-display text-5xl font-light tabular-nums">{progress}<span className="text-2xl text-ink-2">%</span></p>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-center gap-5 p-5 sm:p-6" role="status" aria-live="polite">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-accent-soft">LUMENZA Studio</p>
          <h2 className="font-display mt-1 text-2xl font-light">{failed ? 'No pudimos procesar la imagen' : 'Revelando tus versiones'}</h2>
          <p className="mt-1 text-sm text-ink-2">{failed ? (error ?? 'Ocurrió un error inesperado.') : stageText(stage, status)}</p>
        </div>

        {!failed && (
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Progreso del procesamiento">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(4, progress)}%` }} /></div>
          </div>
        )}

        <ol className="space-y-2 text-sm">
          {STEPS.map((s, i) => {
            const next = STEPS[i + 1]?.from ?? 101;
            const done = progress >= next || status === 'ready';
            const current = !done && active && progress >= s.from;
            return (
              <li key={s.id} className={`flex items-center gap-2.5 transition-colors ${done ? 'text-ink' : current ? 'text-ink' : 'text-ink-2'}`}>
                <span className={`grid size-5 place-items-center rounded-full border ${done ? 'border-accent bg-accent text-on-accent' : current ? 'border-accent' : 'border-line'}`}>
                  {done ? <Check className="size-3" strokeWidth={3} /> : current ? <Loader2 className="size-3 animate-spin text-accent" /> : null}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>

        {failed ? (
          post.isOwner ? (
            <div>
              <Button loading={retry.isPending} icon={<RefreshCcw className="size-4" />} onClick={() => retry.mutate()}>Reintentar procesamiento</Button>
              {retry.error && <p role="alert" className="mt-2 text-sm text-danger">{retry.error.message}</p>}
              <p className="mt-2 text-xs text-ink-2">Intentos realizados: {attempts}. Si la imagen está dañada, elimina la publicación y súbela de nuevo.</p>
            </div>
          ) : null
        ) : (
          <p className="text-xs text-ink-2">Puedes salir de esta página: el procesamiento continúa en segundo plano y verás el resultado al volver.</p>
        )}
      </div>
    </div>
  );
}

/** Versión compacta para tarjetas del feed y cuadrículas. */
export function ProcessingTile({ post, className = '' }: { post: Post; className?: string }) {
  const failed = post.processing.status === 'failed';
  return (
    <div
      className={`relative grid place-items-center overflow-hidden ${className}`}
      style={{ aspectRatio: `${post.photo.width} / ${post.photo.height}`, background: 'radial-gradient(90% 80% at 30% 20%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%), var(--surface-2)' }}
      role="img"
      aria-label={failed ? 'Error al procesar la fotografía' : `Procesando fotografía, ${post.processing.progress} %`}
    >
      <div className="text-center text-ink-2">
        {failed ? <TriangleAlert className="mx-auto size-6 text-danger" strokeWidth={1.5} /> : <div className="mx-auto w-fit motion-safe:animate-[spin_6s_linear_infinite]"><LogoMark size={36} /></div>}
        <p className="mt-2 text-xs">{failed ? 'Error al procesar' : `Procesando · ${post.processing.progress} %`}</p>
      </div>
    </div>
  );
}
