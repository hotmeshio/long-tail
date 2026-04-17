import type { LTOAuthStartConfig, LTOAuthProviderConfig } from '../../types/oauth';
import { setEncryptionKey } from './crypto';
import { registerProvider, listProviders, getProvider } from './providers';
import { loggerRegistry } from '../../lib/logger';

export { encrypt, decrypt, getEncryptionKey, setEncryptionKey } from './crypto';
export { createOAuthState, consumeOAuthState } from './state';
export { registerProvider, getProvider, listProviders } from './providers';
export type { ProviderHandler, OAuthTokens } from './providers';
export {
  upsertOAuthToken,
  getOAuthToken,
  getFreshAccessToken,
  listOAuthConnections,
  deleteOAuthConnection,
  getUserByOAuthProvider,
} from './db';

/** Well-known env var patterns for auto-detecting OAuth providers. */
const ENV_PROVIDERS: Array<{ provider: string; idVar: string; secretVar: string }> = [
  { provider: 'google', idVar: 'OAUTH_GOOGLE_CLIENT_ID', secretVar: 'OAUTH_GOOGLE_CLIENT_SECRET' },
  { provider: 'github', idVar: 'OAUTH_GITHUB_CLIENT_ID', secretVar: 'OAUTH_GITHUB_CLIENT_SECRET' },
  { provider: 'microsoft', idVar: 'OAUTH_MICROSOFT_CLIENT_ID', secretVar: 'OAUTH_MICROSOFT_CLIENT_SECRET' },
  { provider: 'mock', idVar: 'OAUTH_MOCK_CLIENT_ID', secretVar: 'OAUTH_MOCK_CLIENT_SECRET' },
];

/**
 * Credential-only providers that register unconditionally.
 * These don't use real OAuth (no clientId/clientSecret needed) —
 * they store user-provided API keys via a dashboard form.
 */
const CREDENTIAL_PROVIDERS: LTOAuthProviderConfig[] = [
  { provider: 'anthropic', clientId: 'credential-flow', clientSecret: 'n/a', scopes: [] },
];

/**
 * Initialize the OAuth service.
 * Called from start.ts when auth.oauth is configured.
 * Also scans environment variables for provider credentials.
 */
export function initializeOAuth(config?: LTOAuthStartConfig): void {
  // Set encryption key
  const encKey = config?.encryptionKey || process.env.OAUTH_ENCRYPTION_KEY;
  if (encKey) {
    setEncryptionKey(encKey);
  }

  // Register providers from startup config
  if (config?.providers) {
    for (const p of config.providers) {
      registerProvider(p);
    }
  }

  // Auto-detect providers from environment variables
  for (const { provider, idVar, secretVar } of ENV_PROVIDERS) {
    const clientId = process.env[idVar];
    const clientSecret = process.env[secretVar];
    if (clientId && clientSecret && !getProvider(provider)) {
      registerProvider({ provider, clientId, clientSecret, scopes: [] });
    }
  }

  // Register built-in credential providers (API key paste flow, no real OAuth)
  for (const cfg of CREDENTIAL_PROVIDERS) {
    if (!getProvider(cfg.provider)) {
      registerProvider(cfg);
    }
  }

  const registered = listProviders();
  if (registered.length > 0) {
    loggerRegistry.info(`[oauth] initialized with ${registered.length} provider(s): ${registered.map((p) => p.provider).join(', ')}`);
  }
}
