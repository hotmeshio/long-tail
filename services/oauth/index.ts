import type { LTOAuthStartConfig, LTOAuthProviderConfig } from '../../types/oauth';
import { setEncryptionKey } from './crypto';
import { registerProvider, listProviders, getProvider } from './providers';
import { loggerRegistry } from '../logger';

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

  const registered = listProviders();
  if (registered.length > 0) {
    loggerRegistry.info(`[oauth] initialized with ${registered.length} provider(s): ${registered.map((p) => p.provider).join(', ')}`);
  }
}
