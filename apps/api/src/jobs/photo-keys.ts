import type { VariantKind } from '../images/transforms.js';
import { ALL_KINDS } from '../images/transforms.js';

/** Claves de almacenamiento deterministas: permiten limpiar objetos aunque la fila de BD ya no exista. */
export const keyBase = (authorId: string, postId: string) => `photos/${authorId}/${postId}`;
export const originalKey = (authorId: string, postId: string, ext: string) => `${keyBase(authorId, postId)}/original.${ext}`;
export const variantKey = (authorId: string, postId: string, kind: VariantKind) => `${keyBase(authorId, postId)}/${kind}.webp`;
export const allObjectKeys = (authorId: string, postId: string) => [
  ...['jpg', 'png', 'webp'].map((e) => originalKey(authorId, postId, e)),
  ...ALL_KINDS.map((k) => variantKey(authorId, postId, k)),
];
