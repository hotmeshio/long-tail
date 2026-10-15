import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateBotApiKey: vi.fn(), resolvePrincipal: vi.fn(), getLiveGrant: vi.fn(), sso: null as any,
}));
vi.mock('../../services/auth/bot-api-key', () => ({ validateBotApiKey: mocks.validateBotApiKey }));
vi.mock('../../services/iam/principal', () => ({ resolvePrincipal: mocks.resolvePrincipal }));
vi.mock('../../modules/sso', () => ({ getSSOConfig: () => mocks.sso }));
vi.mock('../../services/auth/oauth-server/store', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getLiveGrant: mocks.getLiveGrant,
}));

import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { requireMcpAuth } from '../../modules/mcp-auth';
import { setOAuthServerConfig, clearOAuthServerConfig, getOAuthServerSettings } from '../../modules/oauth-server';
import { signAccessToken } from '../../services/auth/oauth-server';
import type { LTGrantSnapshot } from '../../types';

const SECRET = 'mcp-auth-secret';
const ISSUER = 'https://api.example.com/longtail';
const USER = '00000000-0000-4000-8000-0000000000c9';
const SNAPSHOT: LTGrantSnapshot = {
  grant_id: '00000000-0000-4000-8000-0000000000d9', user_id: USER, client_id: 'ltc_c',
  policy: { preset: 'read_only' }, scope: 'mcp:read',
  roles: [{ role: 'reviewer', type: 'member', read_scope: 'all', write_scope: 'none' }],
};
const TARGET = { issuer: ISSUER, audience: `${ISSUER}/mcp` };
const METADATA = 'https://api.example.com/.well-known/oauth-protected-resource/longtail/mcp';
let savedSecret: string;

async function authenticate(authorization?: string) {
  const headers = new Map<string, string>();
  const req = { headers: { authorization } } as any;
  let outcome = 'no response';
  const res = {
    setHeader: (k: string, v: string) => headers.set(k, v),
    removeHeader: (k: string) => headers.delete(k),
    status(code: number) { this.code = code; return this; },
    json(body: { error: string }) { outcome = `${this.code} ${body.error}`; },
  } as any;
  await requireMcpAuth(req, res, () => { outcome = 'next'; });
  return { outcome, auth: req.auth, challenge: headers.get('WWW-Authenticate') };
}

const bearer = (token: string) => `Bearer ${token}`;

beforeAll(() => { savedSecret = config.JWT_SECRET; (config as any).JWT_SECRET = SECRET; });
afterAll(() => { (config as any).JWT_SECRET = savedSecret; clearOAuthServerConfig(); });
beforeEach(() => {
  clearOAuthServerConfig();
  vi.clearAllMocks();
  mocks.sso = null;
  mocks.getLiveGrant.mockResolvedValue(SNAPSHOT);
});

describe('OAuth server settings', () => {
  it('derive the resource and its metadata URL from the issuer, ignoring a trailing slash; allowed redirects are canonical https URIs', () => {
    setOAuthServerConfig({ issuer: `${ISSUER}/`, allowedRedirectUris: ['https://Claude.ai/api/mcp/auth_callback', 'http://not-https/cb'] });
    expect(getOAuthServerSettings()).toEqual({
      issuer: ISSUER, resource: `${ISSUER}/mcp`, resourceMetadataUrl: METADATA,
      allowedRedirectUris: ['https://claude.ai/api/mcp/auth_callback'],
    });
  });
});

describe('requireMcpAuth without the OAuth server', () => {
  it('is requireAuth: sessions pass, missing credentials get 401 with no challenge', async () => {
    expect((await authenticate(bearer(signToken({ userId: USER, role: 'member' }))))).toMatchObject({ outcome: 'next', challenge: undefined });
    expect(await authenticate()).toMatchObject({ outcome: '401 Unauthorized', challenge: undefined });
  });

  it('does not accept access tokens', async () => {
    expect((await authenticate(bearer(signAccessToken(SNAPSHOT, TARGET).token))).outcome).toBe('401 Token missing required userId claim');
  });
});

describe('requireMcpAuth with the OAuth server', () => {
  beforeEach(() => setOAuthServerConfig({ issuer: ISSUER }));

  it('authenticates an access token as the person while its grant is live, with no challenge', async () => {
    const { outcome, auth, challenge } = await authenticate(bearer(signAccessToken(SNAPSHOT, TARGET).token));
    expect(outcome).toBe('next');
    expect(auth).toMatchObject({ userId: USER, role: 'member', principalType: 'oauth', grantId: SNAPSHOT.grant_id, scopes: ['mcp:read'] });
    expect(challenge).toBeUndefined();
    expect(mocks.getLiveGrant).toHaveBeenCalledWith(SNAPSHOT.grant_id, USER);
    expect(mocks.validateBotApiKey).not.toHaveBeenCalled();
  });

  it('acts on the grant as it stands now, not as the token recorded it', async () => {
    const token = signAccessToken(SNAPSHOT, TARGET).token;
    mocks.getLiveGrant.mockResolvedValue({ ...SNAPSHOT, roles: [{ role: 'ops', type: 'admin', read_scope: 'all', write_scope: 'all' }] });
    const { auth } = await authenticate(bearer(token));
    expect(auth).toMatchObject({ role: 'admin', roles: [{ role: 'ops', type: 'admin' }] });
  });

  it('refuses an expired token or one for another resource with invalid_token', async () => {
    for (const token of [signAccessToken(SNAPSHOT, TARGET, -1).token, signAccessToken(SNAPSHOT, { ...TARGET, audience: 'https://other/mcp' }).token]) {
      expect(await authenticate(bearer(token))).toMatchObject({
        outcome: '401 invalid_token', challenge: `Bearer resource_metadata="${METADATA}", error="invalid_token"`,
      });
    }
  });

  it('refuses a token whose grant is revoked or whose person is inactive, in every process', async () => {
    const token = signAccessToken(SNAPSHOT, TARGET).token;
    mocks.getLiveGrant.mockResolvedValue(null);
    expect((await authenticate(bearer(token))).outcome).toBe('401 invalid_token');
  });

  it('refuses a token whose grant now belongs to another client', async () => {
    mocks.getLiveGrant.mockResolvedValue({ ...SNAPSHOT, client_id: 'ltc_other' });
    expect((await authenticate(bearer(signAccessToken(SNAPSHOT, TARGET).token))).outcome).toBe('401 invalid_token');
  });

  it('passes other credentials to the auth adapter, and challenges only when it refuses', async () => {
    const session = await authenticate(bearer(signToken({ userId: USER, role: 'member' })));
    expect(session).toMatchObject({ outcome: 'next', challenge: undefined });
    mocks.validateBotApiKey.mockResolvedValue({ user_id: USER, scopes: ['mcp:read'] });
    expect((await authenticate(bearer('lt_bot_abc'))).auth).toMatchObject({ principalType: 'bot' });
    expect(await authenticate()).toMatchObject({ outcome: '401 Unauthorized', challenge: `Bearer resource_metadata="${METADATA}"` });
  });
});

describe('requireMcpAuth never uses the SSO cookie fallback', () => {
  beforeEach(() => {
    mocks.sso = { resolve: vi.fn(async () => ({ externalId: 'hike-user' })) };
  });

  it('without the OAuth server, a cookie-only request is refused', async () => {
    expect(await authenticate()).toMatchObject({ outcome: '401 Unauthorized' });
    expect(mocks.sso.resolve).not.toHaveBeenCalled();
  });

  it('with the OAuth server, a cookie-only request is refused with the challenge', async () => {
    setOAuthServerConfig({ issuer: ISSUER });
    expect(await authenticate()).toMatchObject({ outcome: '401 Unauthorized', challenge: `Bearer resource_metadata="${METADATA}"` });
    expect(mocks.sso.resolve).not.toHaveBeenCalled();
  });
});
