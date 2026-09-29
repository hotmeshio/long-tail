import type { LTGrantPreset } from '../../../types/oauth-server';

export const MCP_SCOPES = {
  READ: 'mcp:read',
  FULL: 'mcp:full',
} as const;

/** The coarse scope a grant preset is reported as. */
export const PRESET_SCOPE: Record<LTGrantPreset, string> = {
  read_only: MCP_SCOPES.READ,
  just_me: MCP_SCOPES.FULL,
};

/** JOSE `typ` for access tokens (RFC 9068). */
export const ACCESS_TOKEN_TYPE = 'at+jwt';

/** `principalType` of a request authenticated by an OAuth access token. */
export const OAUTH_PRINCIPAL_TYPE = 'oauth';
