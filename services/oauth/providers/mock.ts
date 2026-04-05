import type { LTOAuthProviderConfig } from '../../../types/oauth';

import type { ProviderHandler } from './types';

export function createMockHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  // Browser-facing URL (user's browser redirects here — must be localhost, not Docker hostname)
  const browserAuthUrl = process.env.MOCK_OAUTH_BROWSER_AUTH_URL || 'http://localhost:9080/authorize';
  // Server-facing URLs (app container calls these — Docker-internal hostnames work)
  const tokenUrl = process.env.MOCK_OAUTH_TOKEN_URL || 'http://localhost:9080/token';
  const userinfoUrl = process.env.MOCK_OAUTH_USERINFO_URL || 'http://localhost:9080/userinfo';

  const handler: ProviderHandler = {
    config: { ...cfg, displayName: cfg.displayName || 'Mock (Test)' },
    createAuthorizationURL(state, _codeVerifier) {
      const url = new URL(browserAuthUrl);
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('redirect_uri', handler.config.redirectUri || '');
      url.searchParams.set('state', state);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', cfg.scopes.join(' '));
      return url;
    },
    async validateAuthorizationCode(code, _codeVerifier) {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: handler.config.redirectUri || '',
        }),
      });
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || null,
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : null,
      };
    },
    async refreshAccessToken(refreshToken) {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
        }),
      });
      const data = await res.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        accessTokenExpiresAt: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : null,
      };
    },
    async fetchUserInfo(accessToken) {
      const res = await fetch(userinfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        provider: 'mock',
        providerUserId: data.sub || data.id || 'mock-user',
        email: data.email || null,
        displayName: data.name || null,
        raw: data,
      };
    },
  };
  return handler;
}
