import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Comment, Page, Post, Profile, UserListItem } from './types';

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  return p.toString() ? `?${p}` : '';
};

function infinite<T>(key: unknown[], path: (cursor?: string) => string, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api<Page<T>>(path(pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 20_000,
  });
}
export const flat = <T,>(d: { pages: Page<T>[] } | undefined) => d?.pages.flatMap((p) => p.items) ?? [];

export const useFeed = () => infinite<Post>(['feed'], (c) => `/feed${qs({ cursor: c })}`);
export const useExplore = (f: { category?: string; tag?: string; q?: string }) =>
  infinite<Post>(['explore', f], (c) => `/explore${qs({ ...f, cursor: c })}`);
export const useUserPosts = (username: string) => infinite<Post>(['user-posts', username], (c) => `/users/${username}/posts${qs({ cursor: c })}`);
export const useSaved = (enabled: boolean) => infinite<Post>(['saved'], (c) => `/me/saved${qs({ cursor: c })}`, enabled);
export const useFeatured = () => useQuery({ queryKey: ['featured'], queryFn: () => api<{ items: Post[] }>('/explore/featured'), staleTime: 60_000 });
export const usePost = (id: string) =>
  useQuery({
    queryKey: ['post', id],
    queryFn: async () => (await api<{ post: Post }>(`/posts/${id}`)).post,
    retry: false,
    refetchInterval: (q) => {
      const p = q.state.data;
      if (!p) return false;
      if (['pending', 'processing'].includes(p.processing.status)) return 1200;
      // Foto ya lista pero con análisis de rostros en cola: consulta unos minutos como máximo
      return p.processing.status === 'ready' && p.faces.status === 'pending' && q.state.dataUpdateCount < 100 ? 2000 : false;
    },
  });
export const useProfile = (username: string) => useQuery({ queryKey: ['profile', username], queryFn: async () => (await api<{ profile: Profile }>(`/users/${username}`)).profile, retry: false });
export const useSuggestions = () => useQuery({ queryKey: ['suggestions'], queryFn: () => api<{ items: UserListItem[] }>('/suggestions'), staleTime: 60_000 });
export const useUserList = (username: string, kind: 'followers' | 'following', enabled: boolean) =>
  useQuery({ queryKey: ['user-list', username, kind], queryFn: () => api<{ items: UserListItem[] }>(`/users/${username}/${kind}`), enabled });
export const useSearchUsers = (q: string) => useQuery({ queryKey: ['search-users', q], queryFn: () => api<{ items: UserListItem[] }>(`/search/users?q=${encodeURIComponent(q)}`), enabled: q.length > 0, staleTime: 30_000 });
export const useSearchTags = (q: string) => useQuery({ queryKey: ['search-tags', q], queryFn: () => api<{ items: { tag: string; posts: number }[] }>(`/search/hashtags?q=${encodeURIComponent(q)}`), enabled: q.length > 0, staleTime: 30_000 });
export const useComments = (id: string, enabled = true) => infinite<Comment>(['comments', id], (c) => `/posts/${id}/comments${qs({ cursor: c })}`, enabled);

// ---------- caché ----------
type Patch = Partial<Post>;
const LIST_KEYS = ['feed', 'explore', 'user-posts', 'saved', 'featured', 'post'];

/** Aplica un cambio a una publicación en TODAS las listas cacheadas (feed, explorar, perfil, detalle…). */
export function patchPost(qc: QueryClient, id: string, patch: Patch) {
  const map = (d: unknown): unknown => {
    const x = d as { pages?: Page<Post>[]; items?: Post[]; id?: string };
    if (x?.pages) return { ...x, pages: x.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })) };
    if (x?.items) return { ...x, items: x.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
    if (x?.id === id) return { ...x, ...patch };
    return d;
  };
  qc.setQueriesData({ predicate: (q) => LIST_KEYS.includes(q.queryKey[0] as string) }, map);
}

function removePost(qc: QueryClient, id: string) {
  qc.setQueriesData({ predicate: (q) => LIST_KEYS.includes(q.queryKey[0] as string) && q.queryKey[0] !== 'post' }, (d: unknown) => {
    const x = d as { pages?: Page<Post>[]; items?: Post[] };
    if (x?.pages) return { ...x, pages: x.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.id !== id) })) };
    if (x?.items) return { ...x, items: x.items.filter((i) => i.id !== id) };
    return d;
  });
  qc.removeQueries({ queryKey: ['post', id] });
}

type ToggleState = { likeCount: number; commentCount: number; liked: boolean; saved: boolean };

/** Like/guardar con actualización optimista y reversión si el servidor falla. */
export function useToggle(post: Post, kind: 'like' | 'save') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      const on = kind === 'like' ? post.liked : post.saved;
      return api<ToggleState>(`/posts/${post.id}/${kind}`, { method: on ? 'DELETE' : 'POST' });
    },
    onMutate: () => {
      const prev: Patch = { liked: post.liked, saved: post.saved, likeCount: post.likeCount };
      patchPost(qc, post.id, kind === 'like' ? { liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) } : { saved: !post.saved });
      return prev;
    },
    onSuccess: (s) => patchPost(qc, post.id, { liked: s.liked, saved: s.saved, likeCount: s.likeCount, commentCount: s.commentCount }),
    onError: (_e, _v, prev) => prev && patchPost(qc, post.id, prev),
    onSettled: () => kind === 'save' && qc.invalidateQueries({ queryKey: ['saved'] }),
  });
}

export function useFollow(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (follow: boolean) => api<{ profile: Profile }>(`/users/${username}/follow`, { method: follow ? 'POST' : 'DELETE' }),
    onSuccess: ({ profile }) => {
      qc.setQueryData(['profile', username], profile);
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['user-list'] });
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['user-posts'] });
      qc.invalidateQueries({ queryKey: ['search-users'] });
    },
  });
}

export function useUpdatePost(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { caption: string; tags: string; category: string | null; visibility: string; allowDownload: boolean; coverVariant: string | null }) => api<{ post: Post }>(`/posts/${id}`, { method: 'PATCH', body: v }),
    onSuccess: ({ post }) => {
      patchPost(qc, id, post);
      ['explore', 'featured', 'profile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/posts/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      removePost(qc, id);
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useAddComment(post: Post) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<{ comment: Comment; commentCount: number }>(`/posts/${post.id}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (r) => {
      patchPost(qc, post.id, { commentCount: r.commentCount });
      qc.invalidateQueries({ queryKey: ['comments', post.id] });
    },
  });
}

export function useDeleteComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['comments', postId] });
      qc.invalidateQueries({ queryKey: ['post', postId] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export function useUpdateProfile(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { displayName: string; bio: string }) => api<{ profile: Profile }>('/me/profile', { method: 'PATCH', body: v }),
    onSuccess: ({ profile }) => {
      qc.setQueryData(['profile', username], profile);
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

export const relativeTime = (iso: string) => {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (a < 60) return 'justo ahora';
  const units: [number, number, Intl.RelativeTimeFormatUnit][] = [[3600, 60, 'minute'], [86400, 3600, 'hour'], [604800, 86400, 'day'], [2629800, 604800, 'week'], [31557600, 2629800, 'month']];
  for (const [limit, div, unit] of units) if (a < limit) return f.format(Math.round(s / div), unit);
  return f.format(Math.round(s / 31557600), 'year');
};

// ---------- procesamiento (Fase 4) ----------
const ACTIVE = ['pending', 'processing'];

/** Consulta periódica mientras la fotografía se procesa; al cambiar, parchea todas las listas sin recargar la app. */
export function useProcessingSync(post: Post) {
  const qc = useQueryClient();
  useQuery({
    queryKey: ['post-watch', post.id],
    queryFn: async () => {
      const { post: p } = await api<{ post: Post }>(`/posts/${post.id}`);
      patchPost(qc, post.id, p);
      if (!ACTIVE.includes(p.processing.status)) ['explore', 'featured', 'profile'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      return p;
    },
    enabled: ACTIVE.includes(post.processing.status),
    refetchInterval: 1200,
    gcTime: 0,
    retry: false,
  });
}

export function useReprocess(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ post: Post }>(`/posts/${postId}/reprocess`, { method: 'POST' }),
    onSuccess: ({ post }) => patchPost(qc, postId, post),
  });
}

export function useReanalyzeFaces(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ post: Post }>(`/posts/${postId}/faces/reanalyze`, { method: 'POST' }),
    onSuccess: ({ post }) => {
      patchPost(qc, postId, post);
      qc.invalidateQueries({ queryKey: ['post', postId] });
    },
  });
}
