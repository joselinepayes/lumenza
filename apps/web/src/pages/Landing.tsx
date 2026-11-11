import { Aperture, ScanFace, SwatchBook } from 'lucide-react';
import { ButtonLink } from '../components/ui/Button';
import { Logo } from '../components/ui/Logo';
import { ThemeToggle } from '../components/ui/ThemeToggle';

/* Composición visual de marca (gradientes abstractos). No son fotos de usuarios. */
const frames = [
  { cls: 'col-span-3 row-span-4', bg: 'linear-gradient(160deg,#2a1f5c,#9673f7 60%,#c4b5fd)', label: 'Original' },
  { cls: 'col-span-2 row-span-2', bg: 'linear-gradient(160deg,#111,#888)', label: 'Blanco y negro' },
  { cls: 'col-span-2 row-span-2', bg: 'linear-gradient(160deg,#3b2a1a,#c49a6c)', label: 'Sepia' },
];

const features = [
  { icon: Aperture, title: 'Laboratorio creativo', text: 'Cada fotografía genera tres versiones reales: blanco y negro editorial, sepia cinematográfico y un tono propio.' },
  { icon: ScanFace, title: 'Detección de rostros', text: 'Análisis transparente y opcional. Nunca identificamos personas ni inferimos rasgos sensibles.' },
  { icon: SwatchBook, title: 'La fotografía primero', text: 'Interfaz silenciosa, tipografía editorial y espacio para que la imagen sea la protagonista.' },
];

export default function Landing() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-8 sm:py-5">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-1.5" aria-label="Principal">
          <ThemeToggle />
          <ButtonLink to="/login" variant="ghost" size="sm" className="sm:h-10 sm:px-4">
            <span className="sm:hidden">Entrar</span>
            <span className="hidden sm:inline">Iniciar sesión</span>
          </ButtonLink>
          <span className="hidden min-[440px]:inline">
            <ButtonLink to="/registro" size="sm" className="sm:h-10 sm:px-4">Crear cuenta</ButtonLink>
          </span>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="rise">
            <p className="mb-5 text-xs font-medium uppercase tracking-[0.18em] sm:tracking-[0.3em] text-accent-soft">Red social de fotografía</p>
            <h1 className="font-display text-[2.6rem] font-light leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              Cada mirada cuenta una <em className="font-normal text-accent-soft">historia</em>.
            </h1>
            <p className="mt-6 max-w-md text-lg text-ink-2">
              Comparte tu fotografía, descubre otras miradas y transforma cada imagen en el laboratorio de LUMENZA.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink to="/registro" size="lg">Empezar ahora</ButtonLink>
              <ButtonLink to="/design" size="lg" variant="secondary">Sistema de diseño</ButtonLink>
            </div>
          </div>

          <div className="rise grid aspect-[5/4] grid-cols-5 grid-rows-4 gap-3" style={{ animationDelay: '120ms' }} role="img" aria-label="Composición: fotografía original y dos transformaciones">
            {frames.map((f) => (
              <figure key={f.label} className={`${f.cls} relative overflow-hidden rounded-lg border border-line`} style={{ background: f.bg }}>
                <figcaption className="absolute bottom-2 left-3 text-[11px] font-medium uppercase tracking-widest text-white/85">{f.label}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="bg-surface p-7">
                <Icon className="mb-4 size-5 text-accent" strokeWidth={1.75} aria-hidden />
                <h2 className="mb-2 font-medium">{title}</h2>
                <p className="text-sm leading-relaxed text-ink-2">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-ink-2 sm:px-8">
          <Logo size={20} />
          <span>© {new Date().getFullYear()} LUMENZA. Proyecto académico de Desarrollo Web.</span>
        </div>
      </footer>
    </div>
  );
}
