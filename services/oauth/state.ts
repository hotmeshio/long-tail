import * as crypto from 'crypto';

interface OAuthState {
  codeVerifier: string;
  provider: string;
  returnTo: string;
  createdAt: number;
}

const stateStore = new Map<string, OAuthState>();
const STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Create an OAuth state parameter + PKCE code verifier.
 * The state is stored in memory and expires after 5 minutes.
 */
export function createOAuthState(
  provider: string,
  returnTo: string = '/',
): { state: string; codeVerifier: string } {
  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  stateStore.set(state, {
    codeVerifier,
    provider,
    returnTo,
    createdAt: Date.now(),
  });
  return { state, codeVerifier };
}

/**
 * Consume an OAuth state parameter (one-time use).
 * Returns null if state is unknown, expired, or already consumed.
 */
export function consumeOAuthState(state: string): OAuthState | null {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state);
  if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
  return entry;
}

// Periodic cleanup of expired entries (every 60s)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of stateStore) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      stateStore.delete(key);
    }
  }
}, 60_000);

// Allow Node to exit without waiting for the interval
if (cleanupInterval.unref) cleanupInterval.unref();
