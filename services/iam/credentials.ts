/**
 * Universal credential resolution cascade.
 *
 * Given a principal and provider, resolves the best available credential:
 * 1. Principal's own stored OAuth token / API key
 * 2. System-level environment variable fallback
 */
import type { ToolPrincipal } from '../../types/tool-context';

import { getFreshAccessToken } from '../oauth';
import { loggerRegistry } from '../logger';

/**
 * Thrown when credential resolution finds no credential for a provider.
 * Caught by route handlers to return structured 422 responses.
 */
export class MissingCredentialError extends Error {
  provider: string;
  constructor(provider: string) {
    super(`No credential found for provider "${provider}". Register one at Credentials.`);
    this.name = 'MissingCredentialError';
    this.provider = provider;
  }
}

/** Well-known provider → env var mappings. */
const SYSTEM_ENV_VARS: Record<string, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'],
  openai: ['OPENAI_API_KEY'],
};

export interface ResolvedCredential {
  value: string;
  source: 'user' | 'bot' | 'system';
  type: 'oauth_token' | 'api_key';
}

/**
 * Resolve the best credential for a principal + provider.
 *
 * @param principal - The authenticated principal (user or bot)
 * @param provider - OAuth provider name (e.g., 'anthropic', 'openai')
 * @param label - Optional credential label for multi-credential accounts
 * @returns Resolved credential or null if none available
 */
export async function resolveCredential(
  principal: ToolPrincipal,
  provider: string,
  label?: string,
): Promise<ResolvedCredential | null> {
  // 1. Try principal's stored credential
  try {
    const decrypted = await getFreshAccessToken(principal.id, provider, label);
    if (decrypted) {
      return {
        value: decrypted.accessToken,
        source: principal.type,
        type: 'oauth_token',
      };
    }
  } catch (err) {
    loggerRegistry.debug(`No stored credential for principal=${principal.id} provider=${provider}: ${err}`);
  }

  // 2. System env var fallback
  const envVars = SYSTEM_ENV_VARS[provider];
  if (envVars) {
    for (const varName of envVars) {
      const value = process.env[varName];
      if (value) {
        return {
          value,
          source: 'system',
          type: 'api_key',
        };
      }
    }
  }

  return null;
}
