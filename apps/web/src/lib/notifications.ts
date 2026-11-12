import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Notif, Page, Settings, UserListItem } from './types';

export const useUnreadCount = (enabled = true) =>
  useQuery({ queryKey: ['unread'], queryFn: async () => (await api<{ count: number }>('/notifications/unread-count')).count, enabled, staleTime: 30_000 });

export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api<Page<Notif>>(`/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api<{ count: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {} }),
    onSuccess: ({ count }) => qc.setQueryData(['unread'], count),
  });
}

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/me/settings') });

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { isPrivate?: boolean; notifPrefs?: Partial<Settings['notifPrefs']> }) => api<Settings>('/me/settings', { method: 'PATCH', body: patch }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['follow-requests'] });
    },
  });
}

export const useFollowRequests = (enabled = true) =>
  useQuery({ queryKey: ['follow-requests'], queryFn: () => api<{ items: (UserListItem & { requestedAt: string })[] }>('/me/follow-requests'), enabled });

export function useResolveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { username: string; accept: boolean }) => api<Settings>(`/me/follow-requests/${v.username}/${v.accept ? 'accept' : 'decline'}`, { method: 'POST' }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], { isPrivate: s.isPrivate, notifPrefs: s.notifPrefs, pendingRequests: s.pendingRequests });
      ['follow-requests', 'notifications', 'profile', 'user-list'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });
}

export const useTrendingTags = () => useQuery({ queryKey: ['trending-tags'], queryFn: () => api<{ items: { tag: string; posts: number }[] }>('/explore/trending-tags'), staleTime: 5 * 60_000 });

/** Texto de cada tipo de aviso. */
export const notifText = (n: Pick<Notif, 'type' | 'actor'>) => {
  const who = n.actor?.displayName ?? 'Alguien';
  switch (n.type) {
    case 'like': return `${who} dio me gusta a tu fotografía`;
    case 'comment': return `${who} comentó tu fotografía`;
    case 'follow': return `${who} empezó a seguirte`;
    case 'follow_request': return `${who} quiere seguirte`;
    case 'follow_accepted': return `${who} aceptó tu solicitud`;
    default: return 'Aviso de LUMENZA';
  }
};
