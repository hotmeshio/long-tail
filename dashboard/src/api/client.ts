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
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  let res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // On 401, try a silent token refresh and retry once
  if (res.status === 401 && authToken) {
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

    if (res.status === 401) {
      // Refresh failed or retry still 401 — force logout
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      throw new Error('Session expired');
    }
  } else if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json();
}
