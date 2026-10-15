import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

/** The rights a person grants an MCP client at consent. */
export type GrantPreset = 'read_only' | 'just_me';

export interface OAuthClientInfo {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
}

export interface ConnectedApp {
  grant_id: string;
  client_id: string;
  client_name: string | null;
  policy: { preset: GrantPreset };
  scope: string;
  created_at: string;
  last_used_at: string | null;
}

/** The authorization request the consent page carries, as validated by the server. */
export interface AuthorizationRequest {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  response_type: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export function useOAuthClient(clientId: string | null) {
  return useQuery({
    queryKey: ['oauth-client', clientId],
    queryFn: () => apiFetch<OAuthClientInfo>(`/oauth/clients/${encodeURIComponent(clientId!)}`),
    enabled: !!clientId,
    retry: false,
  });
}

export function useGrantablePresets(enabled: boolean) {
  return useQuery({
    queryKey: ['oauth-presets'],
    queryFn: () => apiFetch<{ presets: GrantPreset[] }>('/oauth/presets'),
    enabled,
  });
}

/** Approve or deny; both answer with the URL to send the browser to. */
export function useConsentDecision() {
  return useMutation({
    mutationFn: (decision: { request: AuthorizationRequest; preset: GrantPreset | null }) =>
      apiFetch<{ redirect: string }>(decision.preset ? '/oauth/authorize' : '/oauth/deny', {
        method: 'POST',
        body: JSON.stringify(decision.preset ? { ...decision.request, preset: decision.preset } : decision.request),
      }),
  });
}

export function useConnectedApps() {
  return useQuery({
    queryKey: ['oauth-grants'],
    queryFn: () => apiFetch<{ grants: ConnectedApp[] }>('/oauth/grants'),
  });
}

export function useDisconnectApp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => apiFetch<{ disconnected: true }>(`/oauth/grants/${encodeURIComponent(grantId)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oauth-grants'] }),
  });
}
