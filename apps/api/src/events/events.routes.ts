import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { addClient, revalidate } from './hub.js';

/** GET /api/events — flujo SSE autenticado por la cookie de sesión. El latido y la revalidación de la sesión los hace el hub. */
export function createEventsRouter() {
  const r = Router();
  r.get('/events', requireAuth, (req, res) => {
    const tokenHash = req.sessionTokenHash;
    if (!tokenHash) { res.status(401).json({ error: { code: 'unauthorized', message: 'Necesitas iniciar sesión' } }); return; }
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Nginx no debe almacenar en búfer este flujo
    });
    res.flushHeaders();
    res.write('retry: 4000\n\nevent: ready\ndata: {}\n\n');
    const remove = addClient(req.user!.id, res, tokenHash);
    req.on('close', remove);
    res.on('error', remove);
    // La sesión pudo revocarse entre la autenticación y el registro de la conexión: se comprueba de inmediato.
    void revalidate([tokenHash]);
  });
  return r;
}
