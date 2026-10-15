import type { OAuthServerSettings } from '../../../modules/oauth-server';
import { MCP_SCOPES } from './constants';

/** Endpoint paths under the issuer. */
export const OAUTH_ENDPOINT_PATHS = {
  AUTHORIZE: '/api/oauth/authorize',
  TOKEN: '/api/oauth/token',
  REGISTER: '/api/oauth/register',
  REVOKE: '/api/oauth/revoke',
} as const;

const SCOPES_SUPPORTED = [MCP_SCOPES.READ, MCP_SCOPES.FULL];

/** RFC 8414 authorization server metadata. */
export function authorizationServerMetadata(settings: OAuthServerSettings): Record<string, unknown> {
  const at = (path: string) => `${settings.issuer}${path}`;
  return {
    issuer: settings.issuer,
    authorization_endpoint: at(OAUTH_ENDPOINT_PATHS.AUTHORIZE),
    token_endpoint: at(OAUTH_ENDPOINT_PATHS.TOKEN),
    registration_endpoint: at(OAUTH_ENDPOINT_PATHS.REGISTER),
    revocation_endpoint: at(OAUTH_ENDPOINT_PATHS.REVOKE),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: SCOPES_SUPPORTED,
  };
}

/** RFC 9728 protected resource metadata for `/mcp`. */
export function protectedResourceMetadata(settings: OAuthServerSettings): Record<string, unknown> {
  return {
    resource: settings.resource,
    authorization_servers: [settings.issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: SCOPES_SUPPORTED,
  };
}

/**
 * Root-relative paths of the two well-known documents. The issuer's and the
 * resource's paths are appended after the well-known segment (RFC 8414 §3,
 * RFC 9728 §3).
 */
export function wellKnownPaths(settings: OAuthServerSettings): { authorizationServer: string; protectedResource: string } {
  const issuerPath = new URL(settings.issuer).pathname.replace(/\/+$/, '');
  return {
    authorizationServer: `/.well-known/oauth-authorization-server${issuerPath}`,
    protectedResource: new URL(settings.resourceMetadataUrl).pathname,
  };
}
