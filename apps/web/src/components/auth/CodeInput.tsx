import { forwardRef, useId, type InputHTMLAttributes } from 'react';

/**
 * Entrada de código de 6 dígitos: un único campo (accesible, con autocompletado `one-time-code` y pegado) con presentación
 * de dígitos espaciados. No usa seis inputs: así lectores de pantalla, gestores de contraseñas y SMS funcionan bien.
 */
export const CodeInput = forwardRef<HTMLInputElement, { label: string; error?: string; onComplete?: (code: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void }>(
  function CodeInput({ label, error, value, onChange, onComplete, ...rest }, ref) {
    const id = useId();
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        <input
          id={id}
          ref={ref}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-e` : undefined}
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            onChange(v);
            if (v.length === 6) onComplete?.(v);
          }}
          placeholder="••••••"
          className={`h-14 w-full rounded-md border bg-surface text-center font-mono text-[1.75rem] tracking-[0.5em] text-ink placeholder:tracking-[0.35em] placeholder:text-ink-2/40 transition-colors focus:border-accent focus:outline-none focus:shadow-[var(--glow)] ${error ? 'border-danger' : 'border-line'}`}
          {...rest}
        />
        {error && <p id={`${id}-e`} role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    );
  },
);
