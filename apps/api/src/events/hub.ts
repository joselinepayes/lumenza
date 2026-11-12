import pg from 'pg';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';

/**
 * Eventos en tiempo real (SSE) sin Redis: quien genera un evento (API o worker) llama a `publish`, que usa
 * `pg_notify` de PostgreSQL; cada proceso de API escucha ese canal y reparte el evento a sus conexiones SSE.
 * El payload NUNCA contiene contenido de la publicación, solo identificadores; el cliente consulta la API (con permisos).
 */
const CHANNEL = 'lumenza_events';
const MAX_CONNECTIONS_PER_USER = 5;

export type AppEvent =
  | { kind: 'notification'; userId: string; id: string; type: string; actor: { username: string; displayName: string } | null; postId: string | null }
  | { kind: 'post'; action: 'created' | 'updated' | 'deleted'; postId: string; authorId: string; authorUsername: string; visibility: 'public' | 'followers' | 'private' };

/** Una conexión SSE y la sesión (hash del token, nunca el token) que la autenticó. El hash solo vive en memoria. */
interface Client { res: Response; tokenHash: string }
const clients = new Map<string, Set<Client>>();

/** Latido y revalidación de sesiones: un único temporizador para todo el hub, activo solo mientras haya conexiones. */
const TICK_MS = 25_000;
let ticker: NodeJS.Timeout | undefined;

export async function publish(evt: AppEvent): Promise<void> {
  try {
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(evt)]);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'No se pudo publicar el evento');
  }
}

function send(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Quita la conexión del registro (idempotente) y detiene el temporizador del hub si ya no queda ninguna. */
function unregister(userId: string, set: Set<Client>, client: Client) {
  set.delete(client);
  if (set.size === 0 && clients.get(userId) === set) clients.delete(userId);
  if (clients.size === 0 && ticker) { clearInterval(ticker); ticker = undefined; }
}

/** Cierra desde el servidor: primero se retira del registro (no recibirá más eventos) y después se finaliza la respuesta. */
function closeClient(userId: string, set: Set<Client>, client: Client) {
  unregister(userId, set, client);
  try { client.res.end(); } catch { /* ya cerrada */ }
}

/** Registra una conexión SSE ya autenticada, ligada a su sesión. Devuelve la función de limpieza. */
export function addClient(userId: string, res: Response, tokenHash: string): () => void {
  let set = clients.get(userId);
  if (!set) clients.set(userId, (set = new Set()));
  while (set.size >= MAX_CONNECTIONS_PER_USER) {
    const oldest = set.values().next().value as Client;
    closeClient(userId, set, oldest);
    set = clients.get(userId) ?? (clients.set(userId, new Set()).get(userId) as Set<Client>);
  }
  const client: Client = { res, tokenHash };
  set.add(client);
  if (!ticker) { ticker = setInterval(() => void maintain(), TICK_MS); ticker.unref(); }
  const mine = set;
  return () => unregister(userId, mine, client);
}

/** Solo lectura (diagnóstico y pruebas): ¿está activo el temporizador de latido y revalidación? */
export const tickerActive = () => ticker !== undefined;
export const connectedCount = () =>[...clients.values()].reduce((n, s) => n + s.size, 0);

/** Cierra de inmediato todas las conexiones de las sesiones indicadas (logout, cambio de contraseña, revocación). */
export function closeSessions(tokenHashes: Iterable<string>): number {
  const targets = new Set(tokenHashes);
  let closed = 0;
  for (const [userId, set] of [...clients]) {
    for (const c of [...set]) if (targets.has(c.tokenHash)) { closeClient(userId, set, c); closed++; }
  }
  return closed;
}
export const closeSession = (tokenHash: string) => closeSessions([tokenHash]);

/**
 * Comprueba contra la BD que las sesiones de las conexiones abiertas siguen vigentes (no revocadas ni caducadas) y cierra
 * las demás. Cubre revocaciones hechas por otra vía o proceso y la expiración natural. Ante un error de BD no se cierra
 * nada (fallo abierto transitorio) y se reintenta en la siguiente pasada.
 */
export async function revalidate(only?: string[]): Promise<number> {
  const hashes = only ?? [...new Set([...clients.values()].flatMap((s) => [...s].map((c) => c.tokenHash)))];
  if (hashes.length === 0) return 0;
  try {
    const ok = new Set((await pool.query<{ token_hash: string }>('SELECT token_hash FROM sessions WHERE token_hash = ANY($1::text[]) AND revoked_at IS NULL AND expires_at > now()', [hashes])).rows.map((r) => r.token_hash));
    return closeSessions(hashes.filter((h) => !ok.has(h)));
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'No se pudieron revalidar las sesiones SSE');
    return 0;
  }
}

/** Pasada periódica: latido a todas las conexiones y revalidación de sus sesiones. */
export async function maintain(): Promise<void> {
  for (const [userId, set] of [...clients]) {
    for (const c of [...set]) {
      try { c.res.write(': latido\n\n'); } catch { closeClient(userId, set, c); }
    }
  }
  await revalidate();
}

const emit = (userId: string, event: string, data: unknown) => {
  const set = clients.get(userId);
  if (!set) return;
  for (const c of [...set]) {
    try { send(c.res, event, data); } catch { closeClient(userId, set, c); }
  }
};

async function dispatch(evt: AppEvent) {
  if (evt.kind === 'notification') return emit(evt.userId, 'notification', evt);
  if (clients.size === 0) return;
  // Audiencia: privada → solo el autor; con perfil privado o «solo seguidores» → seguidores; si no → todos los conectados.
  const followers = new Set((await pool.query<{ follower_id: string }>('SELECT follower_id FROM follows WHERE followee_id = $1', [evt.authorId])).rows.map((r) => r.follower_id));
  const profilePrivate = (await pool.query<{ is_private: boolean }>('SELECT is_private FROM profiles WHERE user_id = $1', [evt.authorId])).rows[0]?.is_private ?? false;
  const restricted = evt.visibility === 'followers' || profilePrivate;
  for (const uid of clients.keys()) {
    const isAuthor = uid === evt.authorId;
    const isFollower = followers.has(uid);
    const allowed = isAuthor || (evt.visibility !== 'private' && (restricted ? isFollower : true));
    if (!allowed) continue;
    emit(uid, 'post', { action: evt.action, postId: evt.postId, authorId: evt.authorId, authorUsername: evt.authorUsername, following: isFollower, own: isAuthor });
  }
}

// ---------- escucha de PostgreSQL ----------
let listener: pg.Client | undefined;
let stopped = false;
let retry = 1000;

async function connect() {
  if (stopped) return;
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  c.on('notification', (m) => {
    if (m.channel !== CHANNEL || !m.payload) return;
    try { void dispatch(JSON.parse(m.payload) as AppEvent).catch((e) => logger.warn({ err: (e as Error).message }, 'Fallo al repartir evento')); } catch { /* payload inválido */ }
  });
  let handled = false;
  const reconnect = () => {
    if (stopped || handled) return;
    handled = true;
    listener = undefined;
    c.removeAllListeners();
    c.end().catch(() => undefined);
    setTimeout(() => void connect(), retry);
    retry = Math.min(retry * 2, 30_000);
  };
  c.on('error', reconnect);
  c.on('end', reconnect);
  try {
    await c.connect();
    await c.query(`LISTEN ${CHANNEL}`);
    listener = c;
    retry = 1000;
    logger.info('Escuchando eventos en tiempo real');
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'No se pudo escuchar eventos; se reintentará');
    reconnect();
  }
}

export function startEventListener() {
  stopped = false;
  void connect();
}

export async function stopEventListener() {
  stopped = true;
  for (const set of clients.values()) for (const c of set) c.res.end();
  clients.clear();
  if (ticker) { clearInterval(ticker); ticker = undefined; }
  await listener?.end().catch(() => undefined);
}
