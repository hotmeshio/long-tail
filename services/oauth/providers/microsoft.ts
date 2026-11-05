import type { LTOAuthProviderConfig } from '../../../types/oauth';

import type { ProviderHandler } from './types';

const MULTI_TENANT_AUTHORITIES = new Set(['common', 'organizations', 'consumers']);

export function createMicrosoftHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const redirectUri = cfg.redirectUri || '';
  const tenantId = process.env.OAUTH_MICROSOFT_TENANT_ID || 'common';
  // Graph does not verify mail or the UPN. Only a single-tenant authority vouches for the account.
  const singleTenant = !MULTI_TENANT_AUTHORITIES.has(tenantId);
  let _ms: any;
  async function getClient() {
    if (!_ms) {
      const { MicrosoftEntraId } = await import('arctic');
      _ms = new MicrosoftEntraId(tenantId, cfg.clientId, cfg.clientSecret, redirectUri);
    }
    return _ms;
  }
  return {
    config: cfg,
    async createAuthorizationURL(state, codeVerifier) {
      const ms = await getClient();
      const scopes = cfg.scopes.length > 0 ? cfg.scopes : ['openid', 'email', 'profile'];
      return ms.createAuthorizationURL(state, codeVerifier, scopes);
    },
    async validateAuthorizationCode(code, codeVerifier) {
      const ms = await getClient();
      const tokens = await ms.validateAuthorizationCode(code, codeVerifier);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
      };
    },
    async refreshAccessToken(refreshToken) {
      const ms = await getClient();
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
        email: singleTenant ? data.mail || data.userPrincipalName || null : null,
        displayName: data.displayName || null,
        raw: data,
      };
    },
  };
}
