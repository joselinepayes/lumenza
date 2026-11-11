import { useState } from 'react';

const sizes = { xs: 'size-7 text-[11px]', sm: 'size-9 text-xs', md: 'size-11 text-sm', lg: 'size-20 text-2xl', xl: 'size-20 text-3xl min-[400px]:size-24 sm:size-32' };

/** Avatar con la foto real o, si no hay, la inicial sobre un degradado estable derivado del nombre. */
export function Avatar({ name, src, size = 'md', className = '' }: { name: string; src: string | null; size?: keyof typeof sizes; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 60, 0) + 250; // matices violetas/azules de la marca
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-full border border-line font-medium text-white ${sizes[size]} ${className}`}
      style={{ background: `linear-gradient(140deg, hsl(${hue} 55% 38%), hsl(${hue + 30} 60% 58%))` }}
      aria-hidden="true"
    >
      {src && !failed ? <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} loading="lazy" /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
