import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';

import { setupRouteTest } from './setup';
import { createOAuthState } from '../../services/oauth/state';
import { createUser, getUserByEmail } from '../../services/user';

/**
 * Drives the real sign-in callback over HTTP with a stand-in provider whose
 * userinfo answer the test controls. Covers the generic refusal and the
 * verified-email perimeter.
 */

const STUB_PORT = 4654;
const REFUSED = 'This account is not allowed to sign in here. Contact an administrator.';
const RUN = Date.now().toString(36);
let userinfo: Record<string, unknown> = {};
let stub: http.Server;

process.env.MOCK_OAUTH_TOKEN_URL = `http://localhost:${STUB_PORT}/token`;
process.env.MOCK_OAUTH_USERINFO_URL = `http://localhost:${STUB_PORT}/userinfo`;
process.env.OAUTH_ENCRYPTION_KEY = 'a'.repeat(64);

const ctx = setupRouteTest(4655, {
  auth: {
    secret: 'route-test-secret',
    oauth: {
      providers: [{ provider: 'mock', clientId: 'mock', clientSecret: 'mock', scopes: ['openid'] }],
      autoProvision: true,
      allowedDomains: ['example.com'],
    },
  },
});

async function signIn(info: Record<string, unknown>) {
  userinfo = info;
  const { state } = createOAuthState('mock', '/');
  const res = await fetch(`${ctx.BASE}/auth/oauth/mock/callback?code=c&state=${state}`, { redirect: 'manual' });
  const location = res.headers.get('location') || '';
  const text = await res.text();
  return { res, location, text, error: new URL(location, 'http://x').searchParams.get('error') };
}

describe('OAuth sign-in callback', () => {
  beforeAll(async () => {
    stub = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') res.end(JSON.stringify({ access_token: 'at', expires_in: 3600 }));
      else res.end(JSON.stringify(userinfo));
    });
    await new Promise<void>((resolve) => stub.listen(STUB_PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  it('refuses an outside email with a generic sentence that names neither the domain list nor the email', async () => {
    const { res, location, text, error } = await signIn({ sub: `out-${RUN}`, email: `outsider-${RUN}@elsewhere.com`, email_verified: true });
    expect(res.status).toBe(302);
    expect(location.startsWith('/login?error=')).toBe(true);
    expect(error).toBe(REFUSED);
    const whole = JSON.stringify({ status: res.status, headers: Object.fromEntries(res.headers), body: text });
    expect(whole).not.toMatch(/example\.com|outsider@|elsewhere/);
    expect(await getUserByEmail(`outsider-${RUN}@elsewhere.com`)).toBeNull();
  });

  it('refuses an unverified email the same way, even inside the list', async () => {
    const { error } = await signIn({ sub: `unv-${RUN}`, email: `unverified-${RUN}@example.com` });
    expect(error).toBe(REFUSED);
    expect(await getUserByEmail(`unverified-${RUN}@example.com`)).toBeNull();
  });

  it('provisions a listed, verified email and redirects with a token', async () => {
    const { res, location } = await signIn({ sub: `in-${RUN}`, email: `newcomer-${RUN}@example.com`, email_verified: true, name: 'New' });
    expect(res.status).toBe(302);
    expect(location.startsWith('/login?token=')).toBe(true);
    expect(await getUserByEmail(`newcomer-${RUN}@example.com`)).not.toBeNull();
  });

  it('signs an invited account in from outside the list, binding the provider id by verified email', async () => {
    const invited = await createUser({ external_id: `invited-${RUN}`, email: `guest-${RUN}@partner.org`, roles: [{ role: 'member', type: 'member' }] });
    const first = await signIn({ sub: `guest-${RUN}`, email: `guest-${RUN}@partner.org`, email_verified: true });
    expect(first.location.startsWith('/login?token=')).toBe(true);
    expect((await getUserByEmail(`guest-${RUN}@partner.org`))!.id).toBe(invited.id);
  });

  it('never matches an invited account by an unverified email', async () => {
    await createUser({ external_id: `target-${RUN}`, email: `target-${RUN}@partner.org`, roles: [{ role: 'member', type: 'member' }] });
    const { error } = await signIn({ sub: `attacker-${RUN}`, email: `target-${RUN}@partner.org` });
    expect(error).toBe(REFUSED);
  });
});
