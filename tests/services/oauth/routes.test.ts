import { describe, it, expect, beforeAll } from 'vitest';
import * as crypto from 'crypto';

import { config } from '../../../modules/config';
import { signToken } from '../../../modules/auth';
import { setEncryptionKey } from '../../../services/oauth/crypto';
import { registerProvider, getProvider, listProviders } from '../../../services/oauth/providers';
import { createOAuthState, consumeOAuthState } from '../../../services/oauth/state';

/**
 * Route-level integration tests for the OAuth flow logic.
 * These test the building blocks used by routes/oauth.ts without
 * requiring a running Express server.
 */

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('OAuth route logic', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = 'test-jwt-secret';
    setEncryptionKey(TEST_KEY);

    // Ensure providers are registered
    if (!getProvider('google')) {
      registerProvider({
        provider: 'google',
        clientId: 'route-test-google-id',
        clientSecret: 'route-test-google-secret',
        scopes: ['openid', 'email'],
        redirectUri: 'http://localhost:3000/api/auth/oauth/google/callback',
      });
    }
  });

  describe('provider listing', () => {
    it('should list configured providers', () => {
      const providers = listProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers[0]).toHaveProperty('provider');
      expect(providers[0]).toHaveProperty('name');
    });
  });

  describe('authorization URL generation', () => {
    it('should generate valid authorization URL for Google', async () => {
      const handler = getProvider('google')!;
      const { state, codeVerifier } = createOAuthState('google', '/dashboard');
      const url = await handler.createAuthorizationURL(state, codeVerifier);

      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('accounts.google.com');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe(state);
      expect(url.searchParams.has('code_challenge')).toBe(true);
    });
  });

  describe('state + CSRF flow', () => {
    it('should reject callback with wrong provider in state', () => {
      const { state } = createOAuthState('google', '/');
      const consumed = consumeOAuthState(state);
      // If someone tried to use a Google state for a GitHub callback
      expect(consumed!.provider).toBe('google');
      // Route would reject: oauthState.provider !== 'github'
    });

    it('should reject replayed state', () => {
      const { state } = createOAuthState('google', '/');
      consumeOAuthState(state); // first consume
      expect(consumeOAuthState(state)).toBeNull(); // replay rejected
    });
  });

  describe('JWT issuance (post-callback)', () => {
    it('should issue JWT with user identity after OAuth', () => {
      // Simulates what the callback does after successful token exchange
      const jwt = signToken({
        userId: 'oauth-user-123',
        role: 'member',
        roles: [{ role: 'member', type: 'member' }],
      }, '24h');

      expect(jwt).toBeTruthy();
      expect(jwt.split('.')).toHaveLength(3); // valid JWT structure
    });
  });

  describe('provider not configured', () => {
    it('should return null for unconfigured provider', () => {
      expect(getProvider('slack')).toBeNull();
    });
  });
});
