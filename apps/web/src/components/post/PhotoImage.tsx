import { ImageOff } from 'lucide-react';
import { useState } from 'react';

/** Reserva el espacio exacto (sin saltos de layout), carga diferida y aparición suave. */
export function PhotoImage({ src, width, height, alt, className = '', eager = false, fit = 'cover', fill = false }: { src: string; width: number; height: number; alt: string; className?: string; eager?: boolean; fit?: 'cover' | 'contain'; fill?: boolean }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  return (
    <div className={`relative overflow-hidden bg-surface-2 ${fill ? 'h-full w-full' : ''} ${className}`} style={fill ? undefined : { aspectRatio: `${width} / ${height}` }}>
      {state === 'error' ? (
        <div className="absolute inset-0 grid place-items-center text-ink-2" role="img" aria-label="No se pudo cargar la imagen"><ImageOff className="size-6" strokeWidth={1.5} /></div>
      ) : (
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={`size-full transition-opacity duration-300 ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
