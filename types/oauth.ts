/**
 * OAuth provider configuration for identity and resource OAuth.
 */
export interface LTOAuthProviderConfig {
  /** Provider identifier: 'google' | 'github' | 'microsoft' | custom string */
  provider: string;
  /** OAuth2 client ID */
  clientId: string;
  /** OAuth2 client secret */
  clientSecret: string;
  /** Authorization scopes */
  scopes: string[];
  /** Override redirect URI (default: auto-computed from server URL) */
  redirectUri?: string;
  /** Display name for login buttons (default: capitalized provider) */
  displayName?: string;
}

/**
 * OAuth startup configuration. Added to LTStartConfig.auth.oauth.
 */
export interface LTOAuthStartConfig {
  /** Encryption key for tokens at rest (32-byte hex). Falls back to OAUTH_ENCRYPTION_KEY env. */
  encryptionKey?: string;
  /** Configured OAuth providers */
  providers?: LTOAuthProviderConfig[];
  /** Auto-provision users on first OAuth login (default: true) */
  autoProvision?: boolean;
  /** Default role type for auto-provisioned OAuth users (default: 'member') */
  defaultRoleType?: 'admin' | 'member';
  /** Base URL for computing redirect URIs (default: derived from request) */
  baseUrl?: string;
}

/**
 * User info returned from an OAuth provider's userinfo endpoint.
 */
export interface LTOAuthUserInfo {
  provider: string;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
  raw: Record<string, any>;
}

/**
 * Decrypted OAuth token set for a user+provider+label.
 */
export interface LTDecryptedToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
  provider: string;
  /** Label distinguishing multiple credentials for the same provider (default: 'default') */
  label: string;
}

/**
 * Database record shape for lt_oauth_tokens.
 */
export interface LTOAuthTokenRecord {
  id: string;
  user_id: string;
  provider: string;
  /** Label distinguishing multiple credentials for the same provider (default: 'default') */
  label: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_type: string;
  scopes: string[];
  expires_at: Date | null;
  provider_user_id: string;
  provider_email: string | null;
  metadata: Record<string, any> | null;
  created_at: Date;
  updated_at: Date;
}
