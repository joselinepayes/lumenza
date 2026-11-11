/** Marca LUMENZA: apertura de diafragma de 6 láminas + wordmark con tracking amplio. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const blades = Array.from({ length: 6 }, (_, i) => i * 60);
  return (
    <svg width={size} height={size} viewBox="-16 -16 32 32" aria-hidden="true" fill="none">
      <circle r="14" stroke="var(--accent)" strokeWidth="1.5" />
      {blades.map((a) => (
        <path
          key={a}
          transform={`rotate(${a})`}
          d="M0-13.2 L7.6-4.4 L0 0"
          stroke="var(--accent-soft)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      <circle r="1.6" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="LUMENZA">
      <LogoMark size={size} />
      <span className="font-display text-base font-medium tracking-[0.2em] text-ink sm:text-[1.05rem] sm:tracking-[0.28em]">LUMENZA</span>
    </span>
  );
}
