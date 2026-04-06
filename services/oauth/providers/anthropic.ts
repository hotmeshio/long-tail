import type { LTOAuthProviderConfig } from '../../../types/oauth';

import type { ProviderHandler } from './types';

// Anthropic does not expose a standard OAuth2 authorization server.
// Instead, users provide a credential via the Long Tail dashboard:
//
//   - OAuth token (sk-ant-oat01-...) from `claude setup-token`
//     -> Uses their Claude subscription (Pro/Max/Teams) at flat rate
//     -> Passed to subprocess as CLAUDE_CODE_OAUTH_TOKEN
//
//   - API key (sk-ant-api03-...) from console.anthropic.com
//     -> Billed per-token against their API account
//     -> Passed to subprocess as ANTHROPIC_API_KEY
//
// Flow:
//   1. createAuthorizationURL -> redirects to /connect/anthropic (dashboard form)
//   2. User pastes credential -> form redirects to callback with it as "code"
//   3. validateAuthorizationCode -> validates against Anthropic API
//   4. fetchUserInfo -> derives identity from the credential
//   5. Credential stored encrypted as access_token in lt_oauth_tokens

export function createAnthropicHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const handler: ProviderHandler = {
    config: { ...cfg, displayName: cfg.displayName || 'Anthropic' },

    createAuthorizationURL(state, _codeVerifier) {
      const baseUrl = handler.config.redirectUri?.replace(
        `/api/auth/oauth/anthropic/callback`, '',
      ) || '';
      const url = new URL(`${baseUrl}/connect/anthropic`);
      url.searchParams.set('state', state);
      return url;
    },

    async validateAuthorizationCode(credential, _codeVerifier) {
      const isOAuthToken = credential.startsWith('sk-ant-oat');

      // Validate the credential by calling the Anthropic API.
      // OAuth tokens use Authorization: Bearer; API keys use x-api-key.
      const headers: Record<string, string> = {
        'anthropic-version': '2023-06-01',
      };
      if (isOAuthToken) {
        headers['Authorization'] = `Bearer ${credential}`;
      } else {
        headers['x-api-key'] = credential;
      }

      const res = await fetch('https://api.anthropic.com/v1/models', { headers });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const kind = isOAuthToken ? 'OAuth token' : 'API key';
        throw new Error(`Invalid Anthropic ${kind}: ${res.status} ${body}`);
      }

      return {
        accessToken: credential,
        refreshToken: null,
        accessTokenExpiresAt: null,
      };
    },

    async refreshAccessToken(_refreshToken) {
      throw new Error('Anthropic credentials do not support refresh');
    },

    async fetchUserInfo(credential) {
      const { createHash } = await import('crypto');
      const keyHash = createHash('sha256').update(credential).digest('hex').slice(0, 16);
      const isOAuthToken = credential.startsWith('sk-ant-oat');
      const prefix = credential.slice(0, 14);

      return {
        provider: 'anthropic',
        providerUserId: `anthropic-${keyHash}`,
        email: null,
        displayName: isOAuthToken
          ? `Claude Subscription (${prefix}...)`
          : `Anthropic API Key (${prefix}...)`,
        raw: {
          credential_type: isOAuthToken ? 'oauth_token' : 'api_key',
          prefix,
        },
      };
    },
  };
  return handler;
}
