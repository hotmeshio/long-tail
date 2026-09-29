import type { OAuthServerSettings } from '../../../modules/oauth-server';
import type { LTGrantPreset, LTOAuthClient } from '../../../types/oauth-server';
import { getClient } from './store';
import { PRESET_SCOPE } from './constants';

/**
 * Validation of an authorization request (RFC 6749 §4.1.1 with PKCE, RFC 7636,
 * and resource indicators, RFC 8707). Used by the authorize redirect and again
 * when the person approves, so the consent page is never trusted.
 */

export interface AuthorizationRequest {
  client: LTOAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope?: string;
  resource: string;
}

export type AuthorizationCheck =
  | { ok: true; request: AuthorizationRequest }
  /** The client or redirect URI can't be trusted: answer here, never redirect. */
  | { ok: false; redirect: false; error: string; description: string }
  /** The client and redirect URI are known: report the error to the client. */
  | { ok: false; redirect: true; redirectUri: string; state?: string; error: string; description: string };

const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43,128}$/;
const PRESETS: ReadonlySet<string> = new Set(Object.keys(PRESET_SCOPE));

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

export async function checkAuthorizationRequest(
  params: Record<string, unknown>,
  settings: OAuthServerSettings,
): Promise<AuthorizationCheck> {
  const clientId = text(params.client_id);
  const redirectUri = text(params.redirect_uri);
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return { ok: false, redirect: false, error: 'invalid_client', description: 'unknown client_id' };
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return { ok: false, redirect: false, error: 'invalid_request', description: 'redirect_uri is not registered for this client' };
  }

  const state = text(params.state);
  const fail = (error: string, description: string): AuthorizationCheck =>
    ({ ok: false, redirect: true, redirectUri, state, error, description });

  if (params.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be code');
  const codeChallenge = text(params.code_challenge);
  if (!codeChallenge || !CODE_CHALLENGE.test(codeChallenge)) return fail('invalid_request', 'a PKCE code_challenge is required');
  if (params.code_challenge_method !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256');
  const resource = text(params.resource) ?? settings.resource;
  if (resource !== settings.resource) return fail('invalid_target', `resource must be ${settings.resource}`);

  return { ok: true, request: { client, redirectUri, codeChallenge, state, scope: text(params.scope), resource } };
}

export function isGrantPreset(value: unknown): value is LTGrantPreset {
  return typeof value === 'string' && PRESETS.has(value);
}

/** `uri` with `params` added to its query, keeping any query it already has. */
export function withQuery(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The presets the person may grant. Read-only always; Just be me only when it
 * adds something: a membership that can write, or an admin tier.
 */
export function grantablePresets(roles: Array<{ type: string; write_scope?: string | null }>): LTGrantPreset[] {
  const canWrite = roles.some((r) => r.type === 'admin' || r.type === 'superadmin' || (r.write_scope ?? 'all') !== 'none');
  return canWrite ? ['read_only', 'just_me'] : ['read_only'];
}
