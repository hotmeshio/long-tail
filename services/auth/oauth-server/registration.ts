/**
 * Dynamic client registration (RFC 7591) for public MCP clients: validation
 * of the requested client metadata, and a per-address registration limit.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2048;
const MAX_NAME_LENGTH = 200;
const GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);
const RESPONSE_TYPES = new Set(['code']);

export const REGISTRATION_ERRORS = {
  INVALID_REDIRECT_URI: 'invalid_redirect_uri',
  INVALID_CLIENT_METADATA: 'invalid_client_metadata',
} as const;

export type RegistrationResult =
  | { ok: true; clientName?: string; redirectUris: string[] }
  | { ok: false; error: string; description: string };

function invalid(error: string, description: string): RegistrationResult {
  return { ok: false, error, description };
}

/** Loopback http on any port, or https on an allowed host. */
export function isAllowedRedirectUri(uri: string, allowedHosts: string[]): boolean {
  if (uri.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol === 'https:') return LOOPBACK_HOSTS.has(url.hostname) || allowedHosts.includes(url.hostname);
  return false;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

export function validateClientMetadata(body: unknown, allowedHosts: string[]): RegistrationResult {
  const input = (body ?? {}) as Record<string, unknown>;
  const { redirect_uris, client_name, token_endpoint_auth_method, grant_types, response_types } = input;

  if (!isStringArray(redirect_uris) || redirect_uris.length === 0 || redirect_uris.length > MAX_REDIRECT_URIS) {
    return invalid(REGISTRATION_ERRORS.INVALID_REDIRECT_URI, `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs`);
  }
  const refused = redirect_uris.find((uri) => !isAllowedRedirectUri(uri, allowedHosts));
  if (refused !== undefined) {
    return invalid(REGISTRATION_ERRORS.INVALID_REDIRECT_URI, `redirect URI not allowed: ${refused.slice(0, 200)}`);
  }
  if (client_name !== undefined && (typeof client_name !== 'string' || client_name.length > MAX_NAME_LENGTH)) {
    return invalid(REGISTRATION_ERRORS.INVALID_CLIENT_METADATA, `client_name must be a string of at most ${MAX_NAME_LENGTH} characters`);
  }
  if (token_endpoint_auth_method !== undefined && token_endpoint_auth_method !== 'none') {
    return invalid(REGISTRATION_ERRORS.INVALID_CLIENT_METADATA, 'only public clients are supported: token_endpoint_auth_method must be none');
  }
  if (grant_types !== undefined && !(isStringArray(grant_types) && grant_types.every((g) => GRANT_TYPES.has(g)))) {
    return invalid(REGISTRATION_ERRORS.INVALID_CLIENT_METADATA, 'grant_types may include only authorization_code and refresh_token');
  }
  if (response_types !== undefined && !(isStringArray(response_types) && response_types.every((r) => RESPONSE_TYPES.has(r)))) {
    return invalid(REGISTRATION_ERRORS.INVALID_CLIENT_METADATA, 'response_types may include only code');
  }
  return { ok: true, clientName: client_name as string | undefined, redirectUris: redirect_uris };
}

/** A fixed-window count of registrations per address, in memory, per process. */
export class RegistrationLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Count one registration from `address`; false when over the limit. */
  allow(address: string, now: number = Date.now()): boolean {
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
    const window = this.windows.get(address) ?? { start: now, count: 0 };
    window.count += 1;
    this.windows.set(address, window);
    return window.count <= this.limit;
  }
}
