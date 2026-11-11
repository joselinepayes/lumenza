import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';

/** Panel dividido: formulario a la izquierda, composición de marca a la derecha (oculta en móvil). */
export function AuthLayout({ title, subtitle, children, footer, hideHeading }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode; hideHeading?: boolean }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-5 py-5 sm:px-10">
        <header className="flex items-center justify-between">
          <Link to="/" aria-label="LUMENZA, ir al inicio"><Logo /></Link>
          <ThemeToggle />
        </header>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          {!hideHeading && (
            <>
              <h1 className="font-display text-4xl font-light tracking-tight">{title}</h1>
              <p className="mb-8 mt-2 text-ink-2">{subtitle}</p>
            </>
          )}
          {children}
          {footer && <p className="mt-8 text-center text-sm text-ink-2">{footer}</p>}
        </main>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-line lg:block" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 80% 10%, color-mix(in srgb, var(--accent) 38%, transparent), transparent 60%), linear-gradient(160deg, var(--surface), var(--bg))' }} />
        <div className="absolute inset-10 grid grid-cols-6 grid-rows-6 gap-3">
          <div className="col-span-4 row-span-4 rounded-lg border border-line" style={{ background: 'linear-gradient(160deg,#2a1f5c,#9673f7 60%,#c4b5fd)' }} />
          <div className="col-span-2 row-span-3 rounded-lg border border-line" style={{ background: 'linear-gradient(160deg,#111,#888)' }} />
          <div className="col-span-2 row-span-3 rounded-lg border border-line" style={{ background: 'linear-gradient(160deg,#3b2a1a,#c49a6c)' }} />
          <div className="col-span-4 row-span-2 flex items-end rounded-lg border border-line p-6" style={{ background: 'var(--surface-2)' }}>
            <p className="font-display text-2xl font-light leading-snug">Cada mirada cuenta una <em className="text-accent-soft">historia</em>.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}
