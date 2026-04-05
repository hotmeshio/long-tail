import { MicrosoftEntraId } from 'arctic';

import type { LTOAuthProviderConfig } from '../../../types/oauth';

import type { ProviderHandler } from './types';

export function createMicrosoftHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const redirectUri = cfg.redirectUri || '';
  const tenantId = process.env.OAUTH_MICROSOFT_TENANT_ID || 'common';
  const ms = new MicrosoftEntraId(tenantId, cfg.clientId, cfg.clientSecret, redirectUri);
  return {
    config: cfg,
    createAuthorizationURL(state, codeVerifier) {
      const scopes = cfg.scopes.length > 0 ? cfg.scopes : ['openid', 'email', 'profile'];
      return ms.createAuthorizationURL(state, codeVerifier, scopes);
    },
    async validateAuthorizationCode(code, codeVerifier) {
      const tokens = await ms.validateAuthorizationCode(code, codeVerifier);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
      };
    },
    async refreshAccessToken(refreshToken) {
      const scopes = cfg.scopes.length > 0 ? cfg.scopes : ['openid', 'email', 'profile'];
      const tokens = await ms.refreshAccessToken(refreshToken, scopes);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : refreshToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
      };
    },
    async fetchUserInfo(accessToken) {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      return {
        provider: 'microsoft',
        providerUserId: data.id,
        email: data.mail || data.userPrincipalName || null,
        displayName: data.displayName || null,
        raw: data,
      };
    },
  };
}
