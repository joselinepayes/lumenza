import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError, api } from './api';

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** Los administradores deben activar MFA. */
  mfaRequired: boolean;
}

export interface AuthConfig {
  recaptcha: { siteKey: string } | null;
  google: boolean;
  mfa: boolean;
}

const Ctx = createContext<{ user: User | null; loading: boolean } | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user?: User }>('/auth/me')).user ?? null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
  return <Ctx.Provider value={{ user: q.data ?? null, loading: q.isPending }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth requiere AuthProvider');
  return c;
}

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/auth/config'), staleTime: Infinity, retry: 1 });

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => qc.setQueryData(['me'], null),
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="grid min-h-dvh place-items-center text-ink-2" role="status">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/inicio" replace /> : <>{children}</>;
}
