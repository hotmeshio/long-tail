export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Return the `exp` claim (Unix seconds) from a JWT, or null if absent/invalid.
 */
export function getTokenExpiry(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp;
}

/**
 * Check whether a JWT is expired (or will expire within `bufferSeconds`).
 * Returns true if the token is expired or cannot be decoded.
 */
export function isTokenExpired(token: string, bufferSeconds = 0): boolean {
  const exp = getTokenExpiry(token);
  if (exp === null) return true;
  return Date.now() / 1000 >= exp - bufferSeconds;
}
