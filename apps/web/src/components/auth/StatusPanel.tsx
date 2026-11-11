import { Check, Loader2, MailCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'loading' | 'success' | 'error' | 'mail';

const icons = { loading: Loader2, success: Check, error: TriangleAlert, mail: MailCheck };

/** Estado editorial a pantalla del panel: icono dentro de un diafragma que "abre", título serif y acciones. */
export function StatusPanel({ tone, title, children, actions }: { tone: Tone; title: string; children?: ReactNode; actions?: ReactNode }) {
  const Icon = icons[tone];
  const color = tone === 'error' ? 'var(--danger)' : tone === 'success' ? 'var(--success)' : 'var(--accent)';
  return (
    <div className="rise text-center" role={tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      <div className="relative mx-auto mb-7 grid size-20 place-items-center">
        <svg viewBox="-20 -20 40 40" className="absolute inset-0 size-full" fill="none" aria-hidden="true">
          <circle r="18" stroke={color} strokeOpacity="0.35" strokeWidth="1" />
          <circle r="18" stroke={color} strokeWidth="1.4" strokeDasharray="113" strokeDashoffset="113" strokeLinecap="round" style={{ animation: 'draw 600ms var(--ease) 80ms forwards' }} transform="rotate(-90)" />
        </svg>
        <Icon className={`size-7 ${tone === 'loading' ? 'animate-spin' : ''}`} style={{ color }} strokeWidth={1.6} aria-hidden />
      </div>
      <h1 className="font-display text-3xl font-light tracking-tight">{title}</h1>
      {children && <div className="mx-auto mt-3 max-w-xs text-ink-2">{children}</div>}
      {actions && <div className="mt-8 flex flex-col gap-3">{actions}</div>}
    </div>
  );
}
