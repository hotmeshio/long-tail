import type { LTOAuthProviderConfig } from '../../../types/oauth';

import type { ProviderHandler } from './types';

export function createGoogleHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const redirectUri = cfg.redirectUri || '';
  let _google: any;
  async function getClient() {
    if (!_google) {
      const { Google } = await import('arctic');
      _google = new Google(cfg.clientId, cfg.clientSecret, redirectUri);
    }
    return _google;
  }
  return {
    config: cfg,
    async createAuthorizationURL(state, codeVerifier) {
      const google = await getClient();
      const scopes = cfg.scopes.length > 0 ? cfg.scopes : ['openid', 'email', 'profile'];
      return google.createAuthorizationURL(state, codeVerifier, scopes);
    },
    async validateAuthorizationCode(code, codeVerifier) {
      const google = await getClient();
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
      };
    },
    async refreshAccessToken(refreshToken) {
      const google = await getClient();
      const tokens = await google.refreshAccessToken(refreshToken);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
      };
    },
    async fetchUserInfo(accessToken) {
      const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        provider: 'google',
        providerUserId: data.id,
        email: data.email || null,
        displayName: data.name || null,
        raw: data,
      };
    },
  };
}
