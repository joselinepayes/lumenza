export interface AuthorDTO {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface PostDTO {
  id: string;
  caption: string;
  category: string | null;
  visibility: 'public' | 'followers' | 'private';
  allowDownload: boolean;
  createdAt: string;
  author: AuthorDTO;
  photo: { id: string; width: number; height: number; bytes: number; mime: string; displayUrl: string; thumbUrl: string };
  processing: { status: 'pending' | 'processing' | 'ready' | 'partial' | 'failed'; progress: number; stage: string | null; error: string | null; attempts: number };
  /** Detección de rostros: solo recuadros normalizados (0–1) sobre la imagen orientada. Sin identidad ni atributos. */
  faces: { status: 'pending' | 'done' | 'failed'; count: number; boxes: { x: number; y: number; w: number; h: number; score: number }[] };
  /** Variantes ya generadas (solo existentes). `display` y `thumbnail` son derivados técnicos; las tres transformaciones son creativas. */
  variants: { kind: string; url: string; width: number; height: number; bytes: number; params: Record<string, unknown> }[];
  tags: string[];
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
  isOwner: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const avatarUrl = (userId: string, key: string | null) => (key ? `/api/media/avatar/${userId}?v=${encodeURIComponent(key.split('/').pop()!.split('.')[0]!)}` : null);

export const CATEGORIES = ['naturaleza', 'arquitectura', 'retratos', 'viajes', 'arte', 'urbana', 'gastronomia'] as const;

// Cursor por keyset (created_at con precisión completa de PG + id)
export const encodeCursor = (createdText: string, id: string) => Buffer.from(`${createdText}|${id}`).toString('base64url');
export function decodeCursor(c: string | undefined): { at: string; id: string } | null {
  if (!c) return null;
  try {
    const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
    if (!at || !id || !/^[0-9a-f-]{36}$/.test(id) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:\d{2})?)?$/.test(at)) return null;
    return { at, id };
  } catch {
    return null;
  }
}
