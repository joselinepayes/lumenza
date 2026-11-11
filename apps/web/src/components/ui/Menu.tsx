import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect: () => void;
}

/** Menú contextual accesible (botón + lista; Esc/clic fuera/flechas). */
export function Menu({ trigger, items, label }: { trigger: ReactNode; items: MenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const els = [...root.current!.querySelectorAll<HTMLElement>('[role=menuitem]')];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    root.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink">
        {trigger}
      </button>
      {open && (
        <div role="menu" className="rise absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-[0_12px_40px_rgb(0_0_0/0.4)]">
          {items.map((it) => (
            <button key={it.label} role="menuitem" type="button" onClick={() => { setOpen(false); it.onSelect(); }} className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none ${it.danger ? 'text-danger' : 'text-ink'}`}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
