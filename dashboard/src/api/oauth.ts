import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface OAuthProvider {
  provider: string;
  name: string;
}

export interface OAuthConnection {
  provider: string;
  label: string;
  email: string | null;
  scopes: string[];
  expires_at: string | null;
  credential_type: string | null;
}

export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  return apiFetch<OAuthProvider[]>('/auth/oauth/providers');
}

export async function disconnectOAuthProvider(provider: string, label?: string): Promise<{ deleted: boolean }> {
  const params = label ? `?label=${encodeURIComponent(label)}` : '';
  return apiFetch(`/auth/oauth/connections/${provider}${params}`, { method: 'DELETE' });
}

export function useOAuthConnections() {
  return useQuery<{ connections: OAuthConnection[] }>({
    queryKey: ['oauth-connections'],
    queryFn: () => apiFetch('/auth/oauth/connections'),
  });
}

export function useDisconnectOAuth() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, label }: { provider: string; label?: string }) =>
      disconnectOAuthProvider(provider, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oauth-connections'] });
    },
  });
}
