import { useId, type InputHTMLAttributes, type Ref } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; ref?: Ref<HTMLInputElement> };

export function Field({ label, error, hint, id, ...rest }: Props) {
  const auto = useId();
  const fid = id ?? auto;
  const msg = fid + '-msg';
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fid} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={fid}
        aria-invalid={!!error}
        aria-describedby={error || hint ? msg : undefined}
        className={`h-11 rounded-md border bg-surface px-3.5 text-ink placeholder:text-ink-2/70 transition-colors duration-150 focus:border-accent focus:outline-none focus:shadow-[var(--glow)] ${error ? 'border-danger' : 'border-line'}`}
        {...rest}
      />
      {(error || hint) && (
        <p id={msg} className={`text-xs ${error ? 'text-danger' : 'text-ink-2'}`} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
