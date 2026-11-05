import { describe, it, expect, afterEach, vi } from 'vitest';

import { createGoogleHandler } from '../../../services/oauth/providers/google';
import { createGitHubHandler } from '../../../services/oauth/providers/github';
import { createMicrosoftHandler } from '../../../services/oauth/providers/microsoft';
import { createMockHandler } from '../../../services/oauth/providers/mock';

const cfg = (provider: string) => ({ provider, clientId: 'id', clientSecret: 'secret', scopes: [] as string[] });

function stubFetch(byUrl: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const hit = Object.entries(byUrl).find(([prefix]) => url.startsWith(prefix));
    return { json: async () => (hit ? hit[1] : {}) };
  }));
}

describe('provider email is present only when verified', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OAUTH_MICROSOFT_TENANT_ID;
  });

  describe('google', () => {
    it('returns the email when email_verified is true', async () => {
      stubFetch({ 'https://openidconnect.googleapis.com': { sub: '1', email: 'a@example.com', email_verified: true, name: 'A' } });
      const info = await createGoogleHandler(cfg('google')).fetchUserInfo('t');
      expect(info).toMatchObject({ providerUserId: '1', email: 'a@example.com' });
    });

    it('returns null when email_verified is false or absent', async () => {
      stubFetch({ 'https://openidconnect.googleapis.com': { sub: '1', email: 'a@example.com', email_verified: false } });
      expect((await createGoogleHandler(cfg('google')).fetchUserInfo('t')).email).toBeNull();
      stubFetch({ 'https://openidconnect.googleapis.com': { sub: '1', email: 'a@example.com' } });
      expect((await createGoogleHandler(cfg('google')).fetchUserInfo('t')).email).toBeNull();
    });
  });

  describe('github', () => {
    it('returns null when only unverified addresses are listed', async () => {
      stubFetch({
        'https://api.github.com/user/emails': [{ email: 'a@example.com', primary: true, verified: false }],
        'https://api.github.com/user': { id: 7, login: 'a' },
      });
      expect((await createGitHubHandler(cfg('github')).fetchUserInfo('t')).email).toBeNull();
    });

    it('prefers the verified primary, else the first verified address', async () => {
      stubFetch({
        'https://api.github.com/user/emails': [
          { email: 'unverified@example.com', primary: true, verified: false },
          { email: 'second@example.com', primary: false, verified: true },
        ],
        'https://api.github.com/user': { id: 7, login: 'a' },
      });
      expect((await createGitHubHandler(cfg('github')).fetchUserInfo('t')).email).toBe('second@example.com');
    });
  });

  describe('microsoft', () => {
    it('returns null under the multi-tenant authority', async () => {
      stubFetch({ 'https://graph.microsoft.com': { id: 'm', mail: 'a@example.com', userPrincipalName: 'a@example.com' } });
      expect((await createMicrosoftHandler(cfg('microsoft')).fetchUserInfo('t')).email).toBeNull();
    });

    it('returns the email under a single-tenant authority', async () => {
      process.env.OAUTH_MICROSOFT_TENANT_ID = '11111111-2222-3333-4444-555555555555';
      stubFetch({ 'https://graph.microsoft.com': { id: 'm', mail: 'a@example.com' } });
      expect((await createMicrosoftHandler(cfg('microsoft')).fetchUserInfo('t')).email).toBe('a@example.com');
    });
  });

  describe('mock', () => {
    it('honours email_verified like a real provider', async () => {
      stubFetch({ 'http://localhost:9080/userinfo': { sub: 'u', email: 'a@example.com', email_verified: true } });
      expect((await createMockHandler(cfg('mock')).fetchUserInfo('t')).email).toBe('a@example.com');
      stubFetch({ 'http://localhost:9080/userinfo': { sub: 'u', email: 'a@example.com' } });
      expect((await createMockHandler(cfg('mock')).fetchUserInfo('t')).email).toBeNull();
    });
  });
});
