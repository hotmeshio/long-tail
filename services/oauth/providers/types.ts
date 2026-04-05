import type { LTOAuthProviderConfig, LTOAuthUserInfo } from '../../../types/oauth';

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
