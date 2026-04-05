import { GitHub } from 'arctic';

import type { LTOAuthProviderConfig } from '../../../types/oauth';

import type { ProviderHandler } from './types';

export function createGitHubHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const redirectUri = cfg.redirectUri || null;
  const github = new GitHub(cfg.clientId, cfg.clientSecret, redirectUri);
  return {
    config: cfg,
    createAuthorizationURL(state, _codeVerifier) {
      const scopes = cfg.scopes.length > 0 ? cfg.scopes : ['read:user', 'user:email'];
      return github.createAuthorizationURL(state, scopes);
    },
    async validateAuthorizationCode(code, _codeVerifier) {
      const tokens = await github.validateAuthorizationCode(code);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: null, // GitHub doesn't use refresh tokens for OAuth apps
        accessTokenExpiresAt: null,
      };
    },
    async refreshAccessToken(_refreshToken) {
      throw new Error('GitHub OAuth apps do not support token refresh');
    },
    async fetchUserInfo(accessToken) {
      const [userRes, emailRes] = await Promise.all([
        fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }),
        fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        }),
      ]);
      const user = await userRes.json();
      const emails: any[] = await emailRes.json().catch(() => []);
      const primary = emails.find((e: any) => e.primary)?.email || emails[0]?.email || null;
      return {
        provider: 'github',
        providerUserId: String(user.id),
        email: primary,
        displayName: user.name || user.login || null,
        raw: user,
      };
    },
  };
}
