import { AlertCircle, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from './Button';

export const Skeleton = ({ className = '', style }: { className?: string; style?: CSSProperties }) => <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} style={style} aria-hidden="true" />;

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rise mx-auto flex max-w-sm flex-col items-center px-4 py-16 text-center">
      <div className="mb-5 grid size-14 place-items-center rounded-full border border-line text-accent"><Icon className="size-6" strokeWidth={1.5} aria-hidden /></div>
      <h2 className="font-display text-2xl font-light">{title}</h2>
      {children && <p className="mt-2 text-ink-2">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message = 'No pudimos cargar el contenido', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-sm flex-col items-center px-4 py-16 text-center">
      <AlertCircle className="mb-4 size-8 text-danger" strokeWidth={1.5} aria-hidden />
      <p className="text-ink-2">{message}</p>
      {onRetry && <Button variant="secondary" className="mt-5" onClick={onRetry}>Reintentar</Button>}
    </div>
  );
}

// ---------- Toasts ----------
interface T { id: number; text: string; tone: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, tone?: T['tone']) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([]);
  const push = useCallback((text: string, tone: T['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, text, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`rise pointer-events-auto rounded-md border bg-surface px-4 py-2.5 text-sm shadow-[0_8px_30px_rgb(0_0_0/0.35)] ${t.tone === 'error' ? 'border-danger/50 text-danger' : 'border-line text-ink'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
