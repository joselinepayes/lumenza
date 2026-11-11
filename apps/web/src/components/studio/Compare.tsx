import { ChevronsLeftRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

interface Props {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  alt: string;
}

/**
 * Comparador antes/después. Ratón y táctil mediante Pointer Events (arrastre con captura; `touch-action: pan-y`
 * mantiene el scroll vertical de la página), teclado con role="slider" (flechas, Shift, PageUp/PageDown, Home/End).
 * Entra con un barrido suave; `prefers-reduced-motion` lo anula globalmente.
 */
export function Compare({ before, after, beforeLabel, afterLabel, alt }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(100);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setPos(50), 60); // barrido de entrada (de 100 % a 50 %)
    return () => clearTimeout(t);
  }, []);

  const setFromX = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };
  const down = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(true);
    setFromX(e.clientX);
  };
  const move = (e: PointerEvent) => drag && setFromX(e.clientX);
  const up = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDrag(false);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const map: Record<string, number> = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, PageDown: pos - 10, PageUp: pos + 10, Home: 0, End: 100 };
    if (e.key in map) {
      e.preventDefault();
      setPos(Math.min(100, Math.max(0, map[e.key]!)));
    }
  };
  const trans = drag ? 'none' : 'clip-path 600ms var(--ease), left 600ms var(--ease)';

  return (
    <div ref={box} className="absolute inset-0 touch-pan-y select-none overflow-hidden" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ cursor: 'ew-resize' }}>
      <img src={before} alt={alt} className="absolute inset-0 size-full object-contain" draggable={false} />
      <img src={after} alt="" className="absolute inset-0 size-full object-contain" draggable={false} style={{ clipPath: `inset(0 0 0 ${pos}%)`, transition: trans }} />
      <span className={`pointer-events-none absolute left-3 top-3 rounded-sm bg-black/55 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white backdrop-blur-sm transition-opacity duration-200 ${pos < 12 ? 'opacity-0' : 'opacity-100'}`}>{beforeLabel}</span>
      <span className={`pointer-events-none absolute right-3 top-3 rounded-sm bg-black/55 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white backdrop-blur-sm transition-opacity duration-200 ${pos > 88 ? 'opacity-0' : 'opacity-100'}`}>{afterLabel}</span>
      <div className="pointer-events-none absolute inset-y-0 w-px bg-white/90 shadow-[0_0_12px_rgb(0_0_0/0.5)]" style={{ left: `${pos}%`, transition: trans }} aria-hidden="true" />
      <button
        type="button"
        role="slider"
        aria-label="Comparador antes y después"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${beforeLabel} ${Math.round(pos)} %, ${afterLabel} ${100 - Math.round(pos)} %`}
        onKeyDown={key}
        className="absolute top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-black/45 text-white shadow-[0_4px_20px_rgb(0_0_0/0.5)] backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ left: `clamp(22px, ${pos}%, calc(100% - 22px))`, transition: trans, touchAction: 'none' }}
      >
        <ChevronsLeftRight className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
