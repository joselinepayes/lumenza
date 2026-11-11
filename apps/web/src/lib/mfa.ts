import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface MfaStatus {
  available: boolean;
  enabled: boolean;
  enabledAt: string | null;
  recoveryRemaining: number;
  requiredForRole: boolean;
  needsPassword: boolean;
}
export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
  issuer: string;
  account: string;
}

export const useMfaStatus = () => useQuery({ queryKey: ['mfa-status'], queryFn: () => api<MfaStatus>('/auth/mfa/status'), staleTime: 10_000 });

const useRefresh = () => {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['mfa-status'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
};

export const useMfaSetup = () => useMutation({ mutationFn: (password?: string) => api<MfaSetup>('/auth/mfa/setup', { method: 'POST', body: { password } }) });

export function useMfaEnable() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (code: string) => api<{ recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: { code } }), onSuccess: refresh });
}

export interface Factor {
  password?: string;
  code?: string;
  recoveryCode?: string;
}
export function useMfaDisable() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (f: Factor) => api<void>('/auth/mfa/disable', { method: 'POST', body: f }), onSuccess: refresh });
}
export function useMfaRegenerate() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (f: Factor) => api<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes/regenerate', { method: 'POST', body: f }), onSuccess: refresh });
}

export const groupSecret = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();
