import { isTokenExpired } from '../lib/jwt';

const BASE_URL = '/api';

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

/**
 * Try to silently refresh the JWT using stored credentials.
 * Returns the new token on success, null on failure.
 */
async function tryRefresh(): Promise<string | null> {
  const creds = sessionStorage.getItem('lt_credentials');
  if (!creds) return null;

  try {
    const { username, password } = JSON.parse(creds);
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token && data.user) {
      sessionStorage.setItem('lt_user_info', JSON.stringify({
        displayName: data.user.display_name,
        username: data.user.external_id,
      }));
    }
    return data.token ?? null;
  } catch {
    return null;
  }
}

// Dedup concurrent refresh attempts
let refreshPromise: Promise<string | null> | null = null;

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    // Proactive check: if the token is already expired client-side,
    // skip the network round-trip and go straight to refresh/logout.
    if (isTokenExpired(authToken)) {
      if (!refreshPromise) {
        refreshPromise = tryRefresh().finally(() => { refreshPromise = null; });
      }
      const newToken = await refreshPromise;
      if (newToken) {
        authToken = newToken;
        window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: { token: newToken } }));
      } else {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        throw new Error('Session expired');
      }
    }
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // On 401/403, try a silent token refresh and retry once
  if ((res.status === 401 || res.status === 403) && authToken) {
    if (!refreshPromise) {
      refreshPromise = tryRefresh().finally(() => { refreshPromise = null; });
    }
    const newToken = await refreshPromise;

    if (newToken) {
      // Update immediately so concurrent requests pick up the new token
      authToken = newToken;
      window.dispatchEvent(new CustomEvent('auth:refreshed', { detail: { token: newToken } }));
      headers['Authorization'] = `Bearer ${newToken}`;
      res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    }

    if (res.status === 401 || res.status === 403) {
      // Refresh failed or retry still unauthorized — force logout
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      throw new Error('Session expired');
    }
  } else if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.message || body.error || res.statusText);
  }

  return res.json();
}
