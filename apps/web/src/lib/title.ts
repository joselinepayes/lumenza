import { useEffect } from 'react';

/**
 * Título de la pestaña por ruta («Inicio | LUMENZA»), sin dependencias. Convive con el contador de avisos sin leer
 * («(3) Inicio | LUMENZA»): el título de la página y el contador se guardan por separado y se combinan al escribir.
 */
const BRAND = 'LUMENZA';
const DEFAULT = `${BRAND} | Cada mirada cuenta una historia`;
let base = DEFAULT;
let unread = 0;

const apply = () => {
  document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${base}` : base;
};

/** Avisos sin leer en el título (los llama `LiveProvider`). */
export const setUnreadInTitle = (n: number) => {
  unread = n;
  apply();
};

/**
 * Fija el título de la página actual. Sin argumento usa el genérico de la marca; `null` no hace nada (p. ej. un 404
 * incrustado dentro de otra página que ya decide su propio título). Debe llamarse antes de cualquier `return` temprano.
 * No incluir información privada: usar títulos genéricos cuando el contenido no sea público para quien lo ve.
 */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    if (title === null) return;
    base = title ? `${title} | ${BRAND}` : DEFAULT;
    apply();
  }, [title]);
}
