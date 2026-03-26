import { describe, it, expect, beforeEach } from 'vitest';

import {
  registerProvider,
  getProvider,
  listProviders,
} from '../services/oauth/providers';

describe('OAuth provider registry', () => {
  // Note: registerProvider adds to a module-level Map, so tests see cumulative state.
  // We test additive behavior rather than isolation.

  it('should register a Google provider', () => {
    registerProvider({
      provider: 'google',
      clientId: 'test-google-id',
      clientSecret: 'test-google-secret',
      scopes: ['openid', 'email'],
    });
    const handler = getProvider('google');
    expect(handler).toBeTruthy();
    expect(handler!.config.provider).toBe('google');
    expect(handler!.config.clientId).toBe('test-google-id');
  });

  it('should register a GitHub provider', () => {
    registerProvider({
      provider: 'github',
      clientId: 'test-github-id',
      clientSecret: 'test-github-secret',
      scopes: ['read:user'],
    });
    const handler = getProvider('github');
    expect(handler).toBeTruthy();
    expect(handler!.config.provider).toBe('github');
  });

  it('should register a Microsoft provider', () => {
    registerProvider({
      provider: 'microsoft',
      clientId: 'test-ms-id',
      clientSecret: 'test-ms-secret',
      scopes: ['openid'],
    });
    const handler = getProvider('microsoft');
    expect(handler).toBeTruthy();
  });

  it('should return null for unregistered provider', () => {
    expect(getProvider('slack')).toBeNull();
  });

  it('should throw for unsupported provider type', () => {
    expect(() =>
      registerProvider({
        provider: 'unsupported-provider',
        clientId: 'id',
        clientSecret: 'secret',
        scopes: [],
      }),
    ).toThrow(/Unsupported OAuth provider/);
  });

  it('should list all registered providers', () => {
    const list = listProviders();
    expect(list.length).toBeGreaterThanOrEqual(3);
    const names = list.map((p) => p.provider);
    expect(names).toContain('google');
    expect(names).toContain('github');
    expect(names).toContain('microsoft');
  });

  it('should generate authorization URLs', () => {
    const google = getProvider('google')!;
    const url = google.createAuthorizationURL('test-state', 'test-verifier');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('state')).toBe('test-state');
    expect(url.searchParams.get('client_id')).toBe('test-google-id');

    const github = getProvider('github')!;
    const ghUrl = github.createAuthorizationURL('gh-state', 'unused-verifier');
    expect(ghUrl).toBeInstanceOf(URL);
    expect(ghUrl.hostname).toBe('github.com');
    expect(ghUrl.searchParams.get('state')).toBe('gh-state');

    const ms = getProvider('microsoft')!;
    const msUrl = ms.createAuthorizationURL('ms-state', 'ms-verifier');
    expect(msUrl).toBeInstanceOf(URL);
    expect(msUrl.searchParams.get('state')).toBe('ms-state');
  });

  it('should use display name or capitalize provider name', () => {
    const list = listProviders();
    const google = list.find((p) => p.provider === 'google');
    expect(google!.name).toBe('Google');
    const github = list.find((p) => p.provider === 'github');
    expect(github!.name).toBe('Github');
  });
});
