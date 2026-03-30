import { apiFetch } from './client';

export interface OAuthProvider {
  provider: string;
  name: string;
}

export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  return apiFetch<OAuthProvider[]>('/auth/oauth/providers');
}

export async function disconnectOAuthProvider(provider: string, label?: string): Promise<{ deleted: boolean }> {
  const params = label ? `?label=${encodeURIComponent(label)}` : '';
  return apiFetch(`/auth/oauth/connections/${provider}${params}`, { method: 'DELETE' });
}
