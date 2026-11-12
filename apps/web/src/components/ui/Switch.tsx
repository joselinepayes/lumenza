export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 disabled:opacity-50 ${checked ? 'border-accent bg-accent' : 'border-line bg-surface-2'}`}>
      <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}
