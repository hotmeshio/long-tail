import { describe, it, expect, afterEach } from 'vitest';

import { initializeOAuth, getProvider } from '../../../services/oauth';

describe('OAuth initialization', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it('should register providers from startup config', () => {
    initializeOAuth({
      encryptionKey: 'a'.repeat(64), // 32 bytes hex
      providers: [
        { provider: 'google', clientId: 'cfg-google-id', clientSecret: 'cfg-google-secret', scopes: ['openid'] },
      ],
    });
    const google = getProvider('google');
    expect(google).toBeTruthy();
    expect(google!.config.clientId).toBe('cfg-google-id');
  });

  it('should auto-detect providers from environment variables', () => {
    process.env.OAUTH_GITHUB_CLIENT_ID = 'env-github-id';
    process.env.OAUTH_GITHUB_CLIENT_SECRET = 'env-github-secret';

    initializeOAuth({
      encryptionKey: 'b'.repeat(64),
    });

    const github = getProvider('github');
    expect(github).toBeTruthy();
    expect(github!.config.clientId).toBe('env-github-id');
  });

  it('should not override startup config with env vars', () => {
    process.env.OAUTH_GOOGLE_CLIENT_ID = 'env-google-id';
    process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'env-google-secret';

    initializeOAuth({
      encryptionKey: 'c'.repeat(64),
      providers: [
        { provider: 'google', clientId: 'cfg-google-id', clientSecret: 'cfg-google-secret', scopes: [] },
      ],
    });

    const google = getProvider('google');
    // Startup config should take precedence
    expect(google!.config.clientId).toBe('cfg-google-id');
  });

  it('should work with no config (no-op)', () => {
    // Should not throw
    expect(() => initializeOAuth()).not.toThrow();
  });
});
