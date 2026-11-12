import { Heart } from 'lucide-react';
import { Button, ButtonLink } from '../components/ui/Button';
import { Field } from '../components/ui/Field';
import { Logo } from '../components/ui/Logo';
import { ThemeToggle } from '../components/ui/ThemeToggle';
import { usePageTitle } from '../lib/title';

const tokens = ['bg', 'surface', 'surface-2', 'text', 'text-2', 'accent', 'accent-soft', 'border', 'danger', 'success'];

export default function DesignSystem() {
  usePageTitle('Sistema de diseño');
  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
      <header className="mb-10 flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ButtonLink to="/" variant="secondary">Volver</ButtonLink>
        </div>
      </header>
      <h1 className="font-display mb-8 text-4xl font-light">Sistema de diseño</h1>

      <Section title="Color">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tokens.map((t) => (
            <div key={t} className="overflow-hidden rounded-md border border-line">
              <div className="h-14" style={{ background: `var(--${t})` }} />
              <p className="bg-surface px-2 py-1.5 text-xs text-ink-2">--{t}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografía">
        <p className="font-display text-5xl font-light">Fraunces — titulares</p>
        <p className="mt-3 text-lg">Inter — interfaz y lectura. Cada mirada cuenta una historia.</p>
        <p className="mt-1 text-sm text-ink-2">Texto secundario, 14 px.</p>
      </Section>

      <Section title="Botones">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="ghost">Fantasma</Button>
          <Button loading>Cargando</Button>
          <Button disabled>Deshabilitado</Button>
          <Button icon={<Heart className="size-4" />} size="sm">Me gusta</Button>
        </div>
      </Section>

      <Section title="Campos">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Correo" type="email" placeholder="tu@correo.com" hint="Nunca lo compartimos." />
          <Field label="Username" defaultValue="ab" error="Mínimo 3 caracteres." />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-[0.25em] text-ink-2">{title}</h2>
      {children}
    </section>
  );
}
