import { apiFetch, getToken } from '../../api/client';

/**
 * What one connection attempt may use. `session-ended` means there is no
 * session to connect with, so attempts stop until the next sign-in.
 */
export type NatsCredentials =
  | { kind: 'ok'; url: string; token: string | null }
  | { kind: 'session-ended' }
  | { kind: 'unavailable' };

/**
 * Fresh connection details for one attempt. Behind the WebSocket proxy the
 * URL carries a new short-lived ticket, so a URL is never reused across
 * attempts. The request goes through `apiFetch`, which refreshes an expired
 * session first and signs the person out only when the refresh fails.
 */
export async function fetchNatsCredentials(fallbackUrl: string | null): Promise<NatsCredentials> {
  if (!getToken()) return { kind: 'session-ended' };
  try {
    const creds = await apiFetch<{ natsWsUrl?: string | null; natsToken?: string | null }>('/nats-credentials');
    const url = creds.natsWsUrl ?? fallbackUrl;
    return url ? { kind: 'ok', url, token: creds.natsToken ?? null } : { kind: 'unavailable' };
  } catch {
    // A failed refresh signs the person out, which clears the token.
    return getToken() ? { kind: 'unavailable' } : { kind: 'session-ended' };
  }
}
