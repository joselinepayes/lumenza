import { useState } from 'react';

/** Lee ?token= una sola vez y lo elimina de la URL/historial para que no quede en la barra ni en capturas. */
export function useUrlToken(): string | null {
  const [token] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) window.history.replaceState(null, '', window.location.pathname);
    return t;
  });
  return token;
}
