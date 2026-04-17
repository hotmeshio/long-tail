import type { LTOAuthProviderConfig } from '../../../types/oauth';
import { loggerRegistry } from '../../../lib/logger';

import { createAnthropicHandler } from './anthropic';
import { createGitHubHandler } from './github';
import { createGoogleHandler } from './google';
import { createMicrosoftHandler } from './microsoft';
import { createMockHandler } from './mock';
import type { ProviderHandler } from './types';

const providers = new Map<string, ProviderHandler>();

export function registerProvider(cfg: LTOAuthProviderConfig): void {
  const handler = createHandler(cfg);
  providers.set(cfg.provider, handler);
  loggerRegistry.info(`[oauth] registered provider: ${cfg.provider}`);
}

export function getProvider(name: string): ProviderHandler | null {
  return providers.get(name) ?? null;
}

export function listProviders(): Array<{ provider: string; name: string }> {
  return Array.from(providers.values()).map((h) => ({
    provider: h.config.provider,
    name: h.config.displayName || capitalize(h.config.provider),
  }));
}

function createHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const { provider } = cfg;

  switch (provider) {
    case 'google':
      return createGoogleHandler(cfg);
    case 'github':
      return createGitHubHandler(cfg);
    case 'microsoft':
      return createMicrosoftHandler(cfg);
    case 'mock':
      return createMockHandler(cfg);
    case 'anthropic':
      return createAnthropicHandler(cfg);
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}. Supported: google, github, microsoft, anthropic, mock`);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
