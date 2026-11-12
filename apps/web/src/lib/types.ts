export interface Author {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}
export interface Variant {
  kind: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  params: Record<string, unknown>;
}
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}
export interface Post {
  id: string;
  caption: string;
  category: string | null;
  visibility: 'public' | 'followers' | 'private';
  allowDownload: boolean;
  createdAt: string;
  author: Author;
  photo: { id: string; width: number; height: number; bytes: number; mime: string; displayUrl: string; thumbUrl: string };
  processing: { status: 'pending' | 'processing' | 'ready' | 'partial' | 'failed'; progress: number; stage: string | null; error: string | null; attempts: number };
  variants: Variant[];
  /** Solo localización de rostros (recuadros normalizados 0–1): sin identidad, plantillas ni atributos. */
  faces: { status: 'pending' | 'done' | 'failed'; count: number; boxes: FaceBox[] };
  tags: string[];
  editedAt: string | null;
  coverVariant: string | null;
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
export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: Author;
  canDelete: boolean;
}
export interface Profile extends Author {
  bio: string;
  createdAt: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  isMe: boolean;
  following: boolean;
  isPrivate: boolean;
  followRequested: boolean;
  canView: boolean;
}
export interface UserListItem extends Author {
  following: boolean;
  isMe: boolean;
  requested?: boolean;
  isPrivate?: boolean;
  /** Motivo de la sugerencia. */
  reason?: string;
}
export type NotifType = 'follow' | 'like' | 'comment' | 'follow_request' | 'follow_accepted' | 'system';
export interface Notif {
  id: string;
  type: NotifType;
  read: boolean;
  createdAt: string;
  postId: string | null;
  thumbUrl: string | null;
  actor: Author | null;
  pending: boolean;
  following: boolean;
}
export interface Settings {
  isPrivate: boolean;
  notifPrefs: { follow: boolean; like: boolean; comment: boolean; follow_request: boolean };
  pendingRequests: number;
}

export const CATEGORIES = [
  { id: 'naturaleza', label: 'Naturaleza' },
  { id: 'arquitectura', label: 'Arquitectura' },
  { id: 'retratos', label: 'Retratos' },
  { id: 'viajes', label: 'Viajes' },
  { id: 'arte', label: 'Arte' },
  { id: 'urbana', label: 'Urbana' },
  { id: 'gastronomia', label: 'Gastronomía' },
] as const;
export const categoryLabel = (id: string | null) => CATEGORIES.find((c) => c.id === id)?.label ?? null;

export const isProcessing = (p: Post) => p.processing.status === 'pending' || p.processing.status === 'processing';
export const isViewable = (p: Post) => p.processing.status === 'ready' || p.processing.status === 'partial';
