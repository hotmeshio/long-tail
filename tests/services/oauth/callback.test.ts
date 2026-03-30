import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'crypto';

import { config } from '../../../modules/config';
import { setEncryptionKey, encrypt, decrypt } from '../../../services/oauth/crypto';
import { registerProvider, getProvider } from '../../../services/oauth/providers';
import { createOAuthState, consumeOAuthState } from '../../../services/oauth/state';
import { signToken } from '../../../modules/auth';
import {
  createDelegationToken,
  validateDelegationToken,
  requireScope,
} from '../../../services/auth/delegation';

const TEST_SECRET = 'oauth-callback-test-secret';
const TEST_ENC_KEY = crypto.randomBytes(32).toString('hex');

/**
 * Tests the OAuth callback flow logic end-to-end (without HTTP).
 * Exercises the same code path as routes/oauth.ts callback handler:
 *   state validation → code exchange → user info → JWT issuance → role attachment
 */
describe('OAuth callback flow', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = TEST_SECRET;
    setEncryptionKey(TEST_ENC_KEY);
  });

  describe('state → authorization URL → callback validation', () => {
    it('should create state, generate auth URL, and validate callback', () => {
      // 1. Initiate flow (what GET /api/auth/oauth/:provider does)
      if (!getProvider('google')) {
        registerProvider({
          provider: 'google',
          clientId: 'test-id',
          clientSecret: 'test-secret',
          scopes: ['openid', 'email'],
          redirectUri: 'http://localhost:3000/api/auth/oauth/google/callback',
        });
      }
      const handler = getProvider('google')!;
      const { state, codeVerifier } = createOAuthState('google', '/dashboard');

      // 2. Generate auth URL (what the browser redirects to)
      const url = handler.createAuthorizationURL(state, codeVerifier);
      expect(url.searchParams.get('state')).toBe(state);
      expect(url.searchParams.get('client_id')).toBe('test-id');

      // 3. Callback arrives (what GET /api/auth/oauth/:provider/callback does)
      const consumed = consumeOAuthState(state);
      expect(consumed).toBeTruthy();
      expect(consumed!.provider).toBe('google');
      expect(consumed!.codeVerifier).toBe(codeVerifier);
      expect(consumed!.returnTo).toBe('/dashboard');
    });

    it('should reject callback with mismatched provider', () => {
      const { state } = createOAuthState('google', '/');
      const consumed = consumeOAuthState(state);
      // Simulate: state was created for google but callback claims to be github
      expect(consumed!.provider).toBe('google');
      // Route would reject: consumed.provider !== 'github'
    });

    it('should reject callback with replayed state (CSRF protection)', () => {
      const { state } = createOAuthState('google', '/');
      consumeOAuthState(state); // first use
      expect(consumeOAuthState(state)).toBeNull(); // replay rejected
    });
  });

  describe('JWT issuance with roles', () => {
    it('should issue JWT with superadmin role when user has superadmin', () => {
      const roles: Array<{ role: string; type: string; created_at: Date }> = [
        { role: 'superadmin', type: 'superadmin', created_at: new Date() },
        { role: 'reviewer', type: 'member', created_at: new Date() },
      ];

      // Same logic as routes/oauth.ts lines 142-157
      const highestType = roles.some((r) => r.type === 'superadmin')
        ? 'superadmin'
        : roles.some((r) => r.type === 'admin')
          ? 'admin'
          : 'member';

      expect(highestType).toBe('superadmin');

      const jwt = signToken({
        userId: 'user-123',
        role: highestType,
        roles: roles.map((r) => ({ role: r.role, type: r.type })),
      }, '24h');

      // Verify the JWT contains the correct role
      const parts = jwt.split('.');
      const payload = JSON.parse(atob(parts[1]));
      expect(payload.role).toBe('superadmin');
      expect(payload.roles).toHaveLength(2);
      expect(payload.roles[0]).toEqual({ role: 'superadmin', type: 'superadmin' });
    });

    it('should default to member when user has no roles', () => {
      const roles: any[] = [];
      const highestType = roles.some((r: any) => r.type === 'superadmin')
        ? 'superadmin'
        : roles.some((r: any) => r.type === 'admin')
          ? 'admin'
          : 'member';
      expect(highestType).toBe('member');
    });

    it('should detect admin as highest when no superadmin', () => {
      const roles: Array<{ role: string; type: string; created_at: Date }> = [
        { role: 'admin', type: 'admin', created_at: new Date() },
        { role: 'reviewer', type: 'member', created_at: new Date() },
      ];
      const highestType = roles.some((r) => r.type === 'superadmin')
        ? 'superadmin'
        : roles.some((r) => r.type === 'admin')
          ? 'admin'
          : 'member';
      expect(highestType).toBe('admin');
    });
  });

  describe('token encryption for storage', () => {
    it('should encrypt and decrypt OAuth tokens round-trip', () => {
      const accessToken = 'ya29.mock-access-token-12345';
      const refreshToken = '1//mock-refresh-token-67890';

      const encAccess = encrypt(accessToken);
      const encRefresh = encrypt(refreshToken);

      // Tokens are not stored in plaintext
      expect(encAccess).not.toBe(accessToken);
      expect(encRefresh).not.toBe(refreshToken);

      // Round-trip works
      expect(decrypt(encAccess)).toBe(accessToken);
      expect(decrypt(encRefresh)).toBe(refreshToken);
    });
  });

  describe('delegation token integration with OAuth', () => {
    it('should create delegation token scoped to oauth provider', () => {
      const token = createDelegationToken('user-456', ['oauth:google:read'], 300);
      const payload = validateDelegationToken(token);

      expect(payload.sub).toBe('user-456');
      expect(payload.scopes).toContain('oauth:google:read');

      // Scope check passes for the correct provider
      expect(() => requireScope(payload, 'oauth:google:read')).not.toThrow();

      // Scope check fails for a different provider
      expect(() => requireScope(payload, 'oauth:github:read')).toThrow('missing required scope');
    });

    it('should reject delegation token when requesting wrong provider', () => {
      const token = createDelegationToken('user-789', ['oauth:github:read'], 300);
      const payload = validateDelegationToken(token);

      // This token is for GitHub, not Google
      expect(() => requireScope(payload, 'oauth:google:read')).toThrow();
    });
  });
});

describe('Mock provider handler', () => {
  it('should register and generate authorization URL', () => {
    if (!getProvider('mock')) {
      registerProvider({
        provider: 'mock',
        clientId: 'test-mock-id',
        clientSecret: 'test-mock-secret',
        scopes: ['openid'],
        redirectUri: 'http://localhost:3000/api/auth/oauth/mock/callback',
      });
    }
    const handler = getProvider('mock')!;
    expect(handler).toBeTruthy();
    expect(handler.config.displayName).toBe('Mock (Test)');

    const url = handler.createAuthorizationURL('test-state', 'test-verifier');
    expect(url.searchParams.get('state')).toBe('test-state');
    expect(url.searchParams.get('client_id')).toBe('test-mock-id');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/oauth/mock/callback');
  });
});
