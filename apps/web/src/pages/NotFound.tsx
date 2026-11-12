import { ButtonLink } from '../components/ui/Button';
import { usePageTitle } from '../lib/title';

export default function NotFound({ inline = false }: { inline?: boolean }) {
  usePageTitle(inline ? null : 'Página no encontrada');
  return (
    <main className={`grid place-items-center px-6 text-center ${inline ? 'py-24' : 'min-h-dvh'}`}>
      <div>
        <p className="font-display text-7xl font-light text-accent-soft">404</p>
        <h1 className="mt-3 text-xl font-medium">Esta fotografía no existe</h1>
        <p className="mb-6 mt-2 text-ink-2">La página que buscas se movió, es privada o nunca estuvo aquí.</p>
        <ButtonLink to="/inicio">Volver al inicio</ButtonLink>
      </div>
    </main>
  );
}
