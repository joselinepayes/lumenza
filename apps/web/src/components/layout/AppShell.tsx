import { Bell, Compass, Home, LogOut, Plus, Settings, User } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, useLogout } from '../../lib/auth';
import { useUnreadCount } from '../../lib/notifications';
import { LiveProvider } from './Live';
import { PublishModal } from '../post/PublishModal';
import { Logo, LogoMark } from '../ui/Logo';
import { ThemeToggle } from '../ui/ThemeToggle';
import { SuggestionsPanel } from './SuggestionsPanel';

const PublishCtx = createContext<() => void>(() => undefined);
export const usePublish = () => useContext(PublishCtx);

const link = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-4 rounded-md px-3 py-2.5 transition-colors duration-150 md:justify-center lg:justify-start ${isActive ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`;

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-[18px] text-on-accent" aria-hidden>{n > 99 ? '99+' : n}</span>;
}

export function AppShell() {
  const { user } = useAuth();
  const logout = useLogout();
  const nav = useNavigate();
  const [publishing, setPublishing] = useState(false);
  const me = `/u/${user?.username}`;
  const open = () => setPublishing(true);
  const unread = useUnreadCount().data ?? 0;

  return (
    <LiveProvider>
    <PublishCtx.Provider value={open}>
      <div className="min-h-dvh md:grid md:grid-cols-[4.5rem_minmax(0,1fr)] lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        {/* Barra lateral: rail de iconos en tablet, completa en escritorio */}
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-3 py-6 md:flex" aria-label="Navegación principal">
          <NavLink to="/inicio" className="mb-8 flex items-center justify-center px-2 lg:justify-start" aria-label="LUMENZA, inicio">
            <span className="lg:hidden"><LogoMark size={30} /></span>
            <span className="hidden lg:block"><Logo /></span>
          </NavLink>
          <nav className="flex flex-col gap-1">
            <NavLink to="/inicio" className={link} aria-label="Inicio"><Home className="size-[22px] shrink-0" strokeWidth={1.75} /><span className="hidden lg:inline">Inicio</span></NavLink>
            <NavLink to="/explorar" className={link} aria-label="Explorar"><Compass className="size-[22px] shrink-0" strokeWidth={1.75} /><span className="hidden lg:inline">Explorar</span></NavLink>
            <NavLink to="/notificaciones" className={link} aria-label={unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos'}><span className="relative"><Bell className="size-[22px] shrink-0" strokeWidth={1.75} /><Badge n={unread} /></span><span className="hidden lg:inline">Avisos</span></NavLink>
            <NavLink to={me} className={link} aria-label="Perfil"><User className="size-[22px] shrink-0" strokeWidth={1.75} /><span className="hidden lg:inline">Perfil</span></NavLink>
            <NavLink to="/ajustes" className={link} aria-label="Ajustes"><Settings className="size-[22px] shrink-0" strokeWidth={1.75} /><span className="hidden lg:inline">Ajustes</span></NavLink>
            <button type="button" onClick={open} aria-label="Nueva publicación" className="mt-4 flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-on-accent transition-shadow duration-200 hover:shadow-[var(--glow)]">
              <Plus className="size-5 shrink-0" strokeWidth={2} /><span className="hidden lg:inline">Publicar</span>
            </button>
          </nav>
          <div className="mt-auto flex flex-col gap-1">
            <div className="flex justify-center lg:justify-start"><ThemeToggle /></div>
            <button type="button" aria-label="Cerrar sesión" disabled={logout.isPending} onClick={() => logout.mutate(undefined, { onSuccess: () => nav('/login', { replace: true }) })} className="flex items-center gap-4 rounded-md px-3 py-2.5 text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink md:justify-center lg:justify-start">
              <LogOut className="size-[22px] shrink-0" strokeWidth={1.75} /><span className="hidden lg:inline">Cerrar sesión</span>
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Barra superior móvil */}
          <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur md:hidden">
            <Logo size={24} />
            <div className="flex items-center">
              <ThemeToggle />
              <NavLink to="/notificaciones" aria-label={unread > 0 ? `Avisos, ${unread} sin leer` : 'Avisos'} className="relative grid size-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"><Bell className="size-[18px]" strokeWidth={1.75} /><Badge n={unread} /></NavLink>
              <NavLink to="/ajustes" aria-label="Ajustes" className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"><Settings className="size-[18px]" strokeWidth={1.75} /></NavLink>
              <button type="button" aria-label="Cerrar sesión" onClick={() => logout.mutate(undefined, { onSuccess: () => nav('/login', { replace: true }) })} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"><LogOut className="size-[18px]" strokeWidth={1.75} /></button>
            </div>
          </header>

          <div className="mx-auto flex w-full max-w-[1040px] justify-center gap-10 px-0 pb-24 sm:px-6 md:pb-10 lg:px-8">
            <main className="w-full min-w-0 max-w-[680px] py-0 sm:py-6"><Outlet /></main>
            <aside className="sticky top-6 hidden h-fit w-72 shrink-0 py-6 xl:block" aria-label="Sugerencias"><SuggestionsPanel /></aside>
          </div>
        </div>

        {/* Navegación inferior móvil */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Navegación principal">
          {[{ to: '/inicio', icon: Home, label: 'Inicio' }, { to: '/explorar', icon: Compass, label: 'Explorar' }].map(({ to, icon: I, label }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors ${isActive ? 'text-accent-soft' : 'text-ink-2'}`}><I className="size-6" strokeWidth={1.75} />{label}</NavLink>
          ))}
          <button type="button" onClick={open} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] text-ink-2" aria-label="Nueva publicación">
            <span className="grid size-6 place-items-center rounded-md bg-accent text-on-accent"><Plus className="size-4" strokeWidth={2.4} /></span>Publicar
          </button>
          <NavLink to={me} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[11px] transition-colors ${isActive ? 'text-accent-soft' : 'text-ink-2'}`}><User className="size-6" strokeWidth={1.75} />Perfil</NavLink>
        </nav>
      </div>
      {publishing && <PublishModal onClose={() => setPublishing(false)} />}
    </PublishCtx.Provider>
    </LiveProvider>
  );
}
