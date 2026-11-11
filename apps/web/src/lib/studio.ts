import type { Post, Variant } from './types';

export type VersionId = 'original' | 'bw_editorial' | 'sepia_cinema' | 'lumen_tone';

export interface Version {
  id: VersionId;
  label: string;
  tag: string;
  blurb: string;
  /** Lo que realmente hace la receta de Sharp (coincide con `params` guardados en PostgreSQL). */
  details: string[];
}

export const VERSIONS: Version[] = [
  { id: 'original', label: 'Original', tag: 'Sin filtros', blurb: 'Tu fotografía tal como la capturaste: orientada correctamente y sin metadatos de ubicación.', details: ['Sin filtros ni retoques', 'Metadatos EXIF y GPS eliminados', 'Almacenado tal cual en la nube'] },
  { id: 'bw_editorial', label: 'Blanco y negro', tag: 'Editorial', blurb: 'Conversión real a escala de grises por luminancia, con un contraste moderado que respeta el detalle de sombras y luces.', details: ['Luminancia Rec. 601', 'Estiramiento de histograma 1–99 %', 'Contraste ×1,10 · gamma 1,06', 'Nitidez ligera y viñeta tenue'] },
  { id: 'sepia_cinema', label: 'Sepia', tag: 'Cinematográfico', blurb: 'Tratamiento cálido sobre la luminancia para no quemar las luces, con negros levantados y viñeta de proyección.', details: ['Desaturación al 80 %', 'Tinte cálido #C48C5C por luminancia', 'Negros +12 · luces ×0,94', 'Viñeta de proyección'] },
  { id: 'lumen_tone', label: 'Tono LUMENZA', tag: 'Identidad propia', blurb: 'Sombras que viran al violeta y luces lilas, con un resplandor suave. Color con carácter, sin sobresaturar.', details: ['Balance por canal R/G/B', 'Resplandor lila → violeta → grafito', 'Saturación ×1,06', 'Nitidez ligera'] },
];

export const versionOf = (id: VersionId) => VERSIONS.find((v) => v.id === id)!;

/** URL de cada versión: el «original» se muestra con la variante de visualización (mismos píxeles, 1440 px). */
export function urlFor(post: Post, id: VersionId): string | null {
  const kind = id === 'original' ? 'display' : id;
  return post.variants.find((v) => v.kind === kind)?.url ?? null;
}
export const variantFor = (post: Post, id: VersionId): Variant | undefined => post.variants.find((v) => v.kind === (id === 'original' ? 'display' : id));

export const STEPS = [
  { id: 'validating', label: 'Validación y limpieza', from: 0 },
  { id: 'display', label: 'Versión de visualización', from: 15 },
  { id: 'thumbnail', label: 'Miniatura', from: 30 },
  { id: 'bw_editorial', label: 'Blanco y negro editorial', from: 42 },
  { id: 'sepia_cinema', label: 'Sepia cinematográfico', from: 60 },
  { id: 'lumen_tone', label: 'Tono LUMENZA', from: 78 },
] as const;

export const stageText = (stage: string | null, status: string) => {
  if (status === 'pending' || stage === 'queued') return 'En cola, esperando al procesador…';
  const i = STEPS.findIndex((s) => s.id === stage);
  if (stage === 'decoding') return 'Preparando la imagen…';
  return i >= 0 ? `Generando: ${STEPS[Math.min(i + 1, STEPS.length - 1)]!.label.toLowerCase()}…` : 'Procesando…';
};

export const fmtBytes = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
