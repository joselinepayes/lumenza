import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { notifText, useUnreadCount } from '../../lib/notifications';
import { playSound, unlockAudioOnGesture } from '../../lib/sound';
import { setUnreadInTitle } from '../../lib/title';
import { useToast } from '../ui/Feedback';

interface LiveState {
  /** Publicaciones nuevas de personas que sigo (aún no mostradas en el inicio). */
  newFeed: number;
  /** Fotografías públicas nuevas (aún no mostradas en Explorar). */
  newExplore: number;
  clear: (kind: 'feed' | 'explore') => void;
  connected: boolean;
}
const Ctx = createContext<LiveState>({ newFeed: 0, newExplore: 0, clear: () => undefined, connected: false });
export const useLive = () => useContext(Ctx);

interface NotifEvent { id: string; type: string; actor: { username: string; displayName: string } | null }
interface PostEvent { action: 'created' | 'updated' | 'deleted'; postId: string; authorId: string; authorUsername: string; following: boolean; own: boolean }

const POST_LISTS = ['feed', 'explore', 'featured', 'user-posts', 'saved', 'post', 'profile'];

/** Conexión SSE única: avisos al instante, publicaciones nuevas y cambios (edición/borrado) sin recargar la página. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const unread = useUnreadCount(Boolean(user));
  const [newFeed, setFeed] = useState(0);
  const [newExplore, setExplore] = useState(0);
  const [connected, setConnected] = useState(false);
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => { unlockAudioOnGesture(); }, []);

  // El contador de avisos sin leer también aparece en el título de la pestaña (se combina con el título de cada página)
  const count = unread.data ?? 0;
  useEffect(() => {
    setUnreadInTitle(count);
    return () => setUnreadInTitle(0);
  }, [count]);

  useEffect(() => {
    if (!user || typeof EventSource === 'undefined') return;
    let first = true;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let es: EventSource | undefined;

    const connect = () => {
      const src = new EventSource('/api/events', { withCredentials: true });
      es = src;
      src.addEventListener('ready', () => {
        setConnected(true);
        // Tras una reconexión se recupera lo que pudo perderse mientras no había conexión
        if (!first) ['feed', 'notifications', 'unread'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        first = false;
      });
      src.onerror = () => {
        setConnected(false);
        // Mientras el navegador reintenta (CONNECTING) no hay nada que hacer. Si desistió (CLOSED: 401 por sesión revocada o caducada,
        // 5xx durante un reinicio del servidor) se comprueba la sesión: si ya no es válida, el usuario pasa a null y este efecto se
        // limpia sin reconectar; si sigue válida, se reabre el flujo tras una pequeña espera.
        if (src.readyState === EventSource.CLOSED && !cancelled) {
          qc.invalidateQueries({ queryKey: ['me'] });
          retryTimer = setTimeout(() => { if (!cancelled) connect(); }, 5000);
        }
      };

      src.addEventListener('notification', (e) => {
      const n = JSON.parse((e as MessageEvent).data) as NotifEvent;
      qc.setQueryData<number>(['unread'], (c) => (c ?? 0) + 1);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      if (n.type === 'follow_request') { qc.invalidateQueries({ queryKey: ['follow-requests'] }); qc.invalidateQueries({ queryKey: ['settings'] }); }
      if (n.type === 'follow' || n.type === 'follow_accepted') ['profile', 'user-list', 'feed', 'suggestions'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (n.type === 'like' || n.type === 'comment') ['feed', 'post', 'user-posts', 'explore'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toastRef.current(notifText({ type: n.type as never, actor: n.actor && { ...n.actor, id: '', avatarUrl: null } }));
      playSound('notify');
    });

      src.addEventListener('post', (e) => {
      const p = JSON.parse((e as MessageEvent).data) as PostEvent;
      if (p.action === 'created') {
        if (p.own) {
          POST_LISTS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
          playSound('success');
          return;
        }
        if (p.following) {
          setFeed((n) => n + 1);
          toastRef.current(`@${p.authorUsername} publicó una nueva fotografía`);
          playSound('post');
        }
        setExplore((n) => n + 1);
        qc.invalidateQueries({ queryKey: ['profile', p.authorUsername] });
        qc.invalidateQueries({ queryKey: ['user-posts', p.authorUsername] });
        return;
      }
      // Edición o borrado: se refrescan las listas y el detalle ya cargados
      POST_LISTS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    });
    };
    connect();
    return () => { cancelled = true; clearTimeout(retryTimer); es?.close(); setConnected(false); };
  }, [user?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = useCallback((kind: 'feed' | 'explore') => (kind === 'feed' ? setFeed(0) : setExplore(0)), []);
  const value = useMemo(() => ({ newFeed, newExplore, clear, connected }), [newFeed, newExplore, clear, connected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Botón flotante «Hay N nuevas…»: evita que el contenido salte mientras se lee. */
export function NewContentPill({ kind, one, many }: { kind: 'feed' | 'explore'; one: string; many: string }) {
  const { newFeed, newExplore, clear } = useLive();
  const qc = useQueryClient();
  const n = kind === 'feed' ? newFeed : newExplore;
  if (n === 0) return null;
  const show = () => {
    clear(kind);
    qc.invalidateQueries({ queryKey: [kind === 'feed' ? 'feed' : 'explore'] });
    qc.invalidateQueries({ queryKey: ['featured'] });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return (
    <div className="pointer-events-none sticky top-16 z-20 flex justify-center md:top-4">
      <button type="button" onClick={show} className="rise pointer-events-auto rounded-full bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-[var(--glow)] transition-transform hover:scale-[1.03]">
        {n === 1 ? `1 ${one} nueva` : `${n} ${many} nuevas`} · Ver
      </button>
    </div>
  );
}
