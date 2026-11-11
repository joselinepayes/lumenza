import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex whitespace-nowrap items-center justify-center gap-2 font-medium rounded-md transition-[background,box-shadow,transform,opacity] duration-200 ease-out active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:shadow-[var(--glow)]',
  secondary: 'bg-surface-2 text-ink border border-line hover:border-accent',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };

const cls = (v: Variant, s: Size) => `${base} ${variants[v]} ${sizes[s]}`;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode };

export function Button({ variant = 'primary', size = 'md', loading, icon, children, disabled, ...rest }: Props) {
  return (
    <button className={cls(variant, size)} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'primary', size = 'md', className = '', icon, children, ...rest }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return <Link className={`${cls(variant, size)} ${className}`} {...rest}>{icon}{children}</Link>;
}
