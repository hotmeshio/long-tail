import { describe, it, expect } from 'vitest';

import {
  isAllowedRedirectUri, validateClientMetadata, RegistrationLimiter, REGISTRATION_ERRORS,
} from '../../../../services/auth/oauth-server/registration';

const HOSTS = ['claude.ai'];

describe('redirect URI rules', () => {
  it('allow loopback http on any port', () => {
    for (const uri of ['http://127.0.0.1:33418/callback', 'http://localhost:6274/cb', 'http://[::1]:9000/x', 'http://127.0.0.1/cb']) {
      expect(isAllowedRedirectUri(uri, HOSTS), uri).toBe(true);
    }
  });

  it('allow https only on allowed hosts (and loopback)', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback', HOSTS)).toBe(true);
    expect(isAllowedRedirectUri('https://localhost:8443/cb', HOSTS)).toBe(true);
    expect(isAllowedRedirectUri('https://evil.example/cb', HOSTS)).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai.evil.example/cb', HOSTS)).toBe(false);
  });

  it('refuse non-loopback http, custom schemes, fragments, userinfo and garbage', () => {
    for (const uri of [
      'http://example.com/cb', 'cursor://anysphere/cb', 'javascript:alert(1)', 'http://127.0.0.1/cb#frag',
      'http://user:pw@127.0.0.1/cb', 'not a uri', `http://127.0.0.1/${'a'.repeat(2100)}`,
    ]) {
      expect(isAllowedRedirectUri(uri, HOSTS), uri.slice(0, 40)).toBe(false);
    }
  });
});

describe('client metadata validation', () => {
  it('accepts a public client', () => {
    expect(validateClientMetadata({
      redirect_uris: ['http://127.0.0.1:1/cb'], client_name: 'Claude Code',
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }, HOSTS)).toEqual({ ok: true, clientName: 'Claude Code', redirectUris: ['http://127.0.0.1:1/cb'] });
  });

  it('requires 1 to 10 allowed redirect URIs', () => {
    for (const body of [{}, { redirect_uris: [] }, { redirect_uris: 'http://127.0.0.1/cb' }, { redirect_uris: Array(11).fill('http://127.0.0.1/cb') }]) {
      expect(validateClientMetadata(body, HOSTS)).toMatchObject({ ok: false, error: REGISTRATION_ERRORS.INVALID_REDIRECT_URI });
    }
    expect(validateClientMetadata({ redirect_uris: ['http://127.0.0.1/cb', 'https://evil.example/cb'] }, HOSTS))
      .toMatchObject({ ok: false, error: REGISTRATION_ERRORS.INVALID_REDIRECT_URI });
  });

  it('refuses confidential clients and unsupported grant or response types', () => {
    const base = { redirect_uris: ['http://127.0.0.1/cb'] };
    for (const extra of [
      { token_endpoint_auth_method: 'client_secret_basic' }, { grant_types: ['client_credentials'] },
      { response_types: ['token'] }, { client_name: 'x'.repeat(201) }, { client_name: 42 },
    ]) {
      expect(validateClientMetadata({ ...base, ...extra }, HOSTS)).toMatchObject({ ok: false, error: REGISTRATION_ERRORS.INVALID_CLIENT_METADATA });
    }
  });
});

describe('registration limiter', () => {
  it('allows the limit per address per window', () => {
    const limiter = new RegistrationLimiter(2, 1000);
    expect([limiter.allow('a', 0), limiter.allow('a', 1), limiter.allow('a', 2)]).toEqual([true, true, false]);
    expect(limiter.allow('b', 3)).toBe(true);
    expect(limiter.allow('a', 1000)).toBe(true);
  });
});
