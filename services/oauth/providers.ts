import { Google, GitHub, MicrosoftEntraId } from 'arctic';

import type { LTOAuthProviderConfig, LTOAuthUserInfo } from '../../types/oauth';
import { loggerRegistry } from '../logger';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
}

export interface ProviderHandler {
  config: LTOAuthProviderConfig;
  createAuthorizationURL(state: string, codeVerifier: string): URL;
  validateAuthorizationCode(code: string, codeVerifier: string): Promise<OAuthTokens>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
  fetchUserInfo(accessToken: string): Promise<LTOAuthUserInfo>;
}

// ── Provider registry ────────────────────────────────────────────────────────

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

// ── Provider factory ─────────────────────────────────────────────────────────

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
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}. Supported: google, github, microsoft, mock`);
  }
}

// ── Google ────────────────────────────────────────────────────────────────────

function createGoogleHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
  const redirectUri = cfg.redirectUri || '';
  const google = new Google(cfg.clientId, cfg.clientSecret, redirectUri);
  return {
    config: cfg,
    createAuthorizationURL(state, codeVerifier) {
      const scopes = cfg.scopes.length > 0 ? cfg.scopes : ['openid', 'email', 'profile'];
      return google.createAuthorizationURL(state, codeVerifier, scopes);
    },
    async validateAuthorizationCode(code, codeVerifier) {
      const tokens = await google.validateAuthorizationCode(code, codeVerifier);
      return {
        accessToken: tokens.accessToken(),
        refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt(),
      };
    },
    async refreshAccessToken(refreshToken) {
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

// ── GitHub ────────────────────────────────────────────────────────────────────

function createGitHubHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
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

// ── Microsoft ────────────────────────────────────────────────────────────────

function createMicrosoftHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
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

// ── Mock (for testing) ───────────────────────────────────────────────────────

function createMockHandler(cfg: LTOAuthProviderConfig): ProviderHandler {
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
