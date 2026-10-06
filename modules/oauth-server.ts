import type { LTOAuthServerConfig } from '../types/oauth-server';

/** The configured authorization server, with the URLs derived from its issuer. */
export interface OAuthServerSettings {
  issuer: string;
  /** The protected resource, and the audience of its access tokens. */
  resource: string;
  /** RFC 9728 protected-resource metadata URL for `resource`. */
  resourceMetadataUrl: string;
  /** Canonical https redirect URIs allowed beyond loopback. */
  allowedRedirectUris: string[];
}

/** An https URI in canonical form, or null when it is not one (a malformed entry never matches). */
export function canonicalHttpsUri(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

let settings: OAuthServerSettings | null = null;

export function setOAuthServerConfig(config: LTOAuthServerConfig): void {
  const issuer = config.issuer.replace(/\/+$/, '');
  const resource = `${issuer}/mcp`;
  const url = new URL(resource);
  settings = {
    issuer,
    resource,
    resourceMetadataUrl: `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`,
    allowedRedirectUris: (config.allowedRedirectUris ?? [])
      .map(canonicalHttpsUri)
      .filter((uri): uri is string => uri !== null),
  };
}

/** Read per request: routers may be mounted before start() configures the server. */
export function getOAuthServerSettings(): OAuthServerSettings | null {
  return settings;
}

/** Reset. Used by tests. */
export function clearOAuthServerConfig(): void {
  settings = null;
}
