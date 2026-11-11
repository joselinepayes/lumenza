import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../lib/theme';

export function ThemeToggle() {
  const { resolved, setPref } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      aria-label={`Cambiar a modo ${next === 'dark' ? 'oscuro' : 'claro'}`}
      className="grid size-10 place-items-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
    >
      {resolved === 'dark' ? <Sun className="size-[18px]" strokeWidth={1.75} /> : <Moon className="size-[18px]" strokeWidth={1.75} />}
    </button>
  );
}
