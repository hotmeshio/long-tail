import { isTokenExpired } from '../lib/jwt';
import { LT_BASE } from '../lib/base-path';

const BASE_URL = `${LT_BASE}/api`;

/**
 * A non-2xx API response. `body` is the parsed JSON error body — for 422
 * schema-validation rejections it is the canonical LTValidationErrorBody
 * (error, code, violations, role, schemaVersion), which the escalation detail
 * page maps into the same errors panel the pre-submission pass feeds.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

export function setToken(token: string | null) {
  authToken = token;
}

export function getToken(): string | null {
  return authToken;
}

// ── Acting identity (badge grant) ────────────────────────────────────────────
// The ActingIdentityProvider registers these. While a grant is held, every
// request carries the token; the server honors it only on the escalation work
// verbs (claim/release/resolve) and ignores it everywhere else, so whoever
// badged in owns the actions with no per-hook wiring.

export const ACTING_TOKEN_HEADER = 'X-LT-Acting-Token';

let actingTokenProvider: (() => string | null) | null = null;
let actingIdentityClear: (() => void) | null = null;

export function setActingTokenProvider(fn: (() => string | null) | null) {
  actingTokenProvider = fn;
}

export function setActingIdentityClear(fn: (() => void) | null) {
  actingIdentityClear = fn;
}

/** True when a 401 body names the acting identity (dead/expired grant). */
function isActingIdentityError(body: unknown): boolean {
  const msg = (body as { error?: unknown } | null)?.error;
  return typeof msg === 'string' && /acting[- ]identity/i.test(msg);
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

  const actingToken = actingTokenProvider?.() ?? null;
  if (actingToken) {
    headers[ACTING_TOKEN_HEADER] = actingToken;
  }

  let res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // A dead badge grant answers 401 with an acting-identity error — the session
  // itself is fine, so this never enters the refresh/logout path. Clear the
  // client-side grant so state matches the server, then rethrow for the caller
  // to surface (a fresh badge scan re-primes and the person retries).
  if (res.status === 401 && actingToken) {
    const body = await res.clone().json().catch(() => null);
    if (isActingIdentityError(body)) {
      actingIdentityClear?.();
      throw new ApiError((body as { error: string }).error, 401, body);
    }
  }

  // On 401 (expired/invalid token), try a silent refresh and retry once.
  // 403 (permission denied) is a business-logic error, not a session issue.
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
    throw new ApiError(body.message || body.error || res.statusText, res.status, body);
  }

  return res.json();
}
