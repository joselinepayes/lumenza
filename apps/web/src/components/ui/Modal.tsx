import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Diálogo accesible: Esc cierra, foco atrapado y restaurado, scroll bloqueado; hoja a pantalla completa en móvil. */
export function Modal({ title, onClose, children, wide = false, full = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; full?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCloseRef.current();
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      const first = els[0]!, last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 backdrop-blur-[2px] sm:place-items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`rise flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-lg border border-line bg-surface shadow-[0_24px_80px_rgb(0_0_0/0.45)] sm:max-h-[90dvh] sm:rounded-lg ${full ? 'h-[100dvh] sm:h-[94dvh] sm:max-w-[1280px]' : wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-display text-xl font-light">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        </header>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
