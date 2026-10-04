import { getToken } from '../../api/client';
import { LT_BASE } from '../base-path';

/**
 * What one connection attempt may use. `session-ended` means the server
 * refused the session, so the sign-in flow takes over and attempts stop.
 */
export type NatsCredentials =
  | { kind: 'ok'; url: string; token: string | null }
  | { kind: 'session-ended' }
  | { kind: 'unavailable' };

/**
 * Fresh connection details for one attempt. Behind the WebSocket proxy the
 * URL carries a new short-lived ticket, so a URL is never reused across
 * attempts. Without a session yet, the server-reported URL is used as is.
 */
export async function fetchNatsCredentials(fallbackUrl: string | null): Promise<NatsCredentials> {
  const jwt = getToken();
  if (!jwt) {
    return fallbackUrl ? { kind: 'ok', url: fallbackUrl, token: null } : { kind: 'unavailable' };
  }
  try {
    const res = await fetch(`${LT_BASE}/api/nats-credentials`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (res.status === 401) return { kind: 'session-ended' };
    if (!res.ok) return { kind: 'unavailable' };
    const creds = await res.json() as { natsWsUrl?: string | null; natsToken?: string | null };
    const url = creds.natsWsUrl ?? fallbackUrl;
    return url ? { kind: 'ok', url, token: creds.natsToken ?? null } : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}
