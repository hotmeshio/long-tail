import { apiFetch } from './client';

export interface OAuthProvider {
  provider: string;
  name: string;
}

export async function fetchOAuthProviders(): Promise<OAuthProvider[]> {
  return apiFetch<OAuthProvider[]>('/auth/oauth/providers');
}

export async function disconnectOAuthProvider(provider: string): Promise<{ deleted: boolean }> {
  return apiFetch(`/auth/oauth/connections/${provider}`, { method: 'DELETE' });
}
