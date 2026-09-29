import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ validateBotApiKey: vi.fn(), resolvePrincipal: vi.fn() }));
vi.mock('../../services/auth/bot-api-key', () => ({ validateBotApiKey: mocks.validateBotApiKey }));
vi.mock('../../services/iam/principal', () => ({ resolvePrincipal: mocks.resolvePrincipal }));
vi.mock('../../modules/sso', () => ({ getSSOConfig: () => null }));

import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { requireMcpAuth } from '../../modules/mcp-auth';
import { setOAuthServerConfig, clearOAuthServerConfig, getOAuthServerSettings } from '../../modules/oauth-server';
import { signAccessToken } from '../../services/auth/oauth-server';
import { markRevoked, clearRevocations } from '../../services/auth/oauth-server/revocations';
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
beforeEach(() => { clearRevocations(); clearOAuthServerConfig(); vi.clearAllMocks(); });

describe('OAuth server settings', () => {
  it('derive the resource and its metadata URL from the issuer, ignoring a trailing slash', () => {
    setOAuthServerConfig({ issuer: `${ISSUER}/`, allowedRedirectHosts: ['claude.ai'] });
    expect(getOAuthServerSettings()).toEqual({
      issuer: ISSUER, resource: `${ISSUER}/mcp`, resourceMetadataUrl: METADATA, allowedRedirectHosts: ['claude.ai'],
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

  it('authenticates an access token as the person, with no lookup and no challenge', async () => {
    const { outcome, auth, challenge } = await authenticate(bearer(signAccessToken(SNAPSHOT, TARGET).token));
    expect(outcome).toBe('next');
    expect(auth).toMatchObject({ userId: USER, role: 'member', principalType: 'oauth', grantId: SNAPSHOT.grant_id, scopes: ['mcp:read'] });
    expect(challenge).toBeUndefined();
    expect(mocks.validateBotApiKey).not.toHaveBeenCalled();
  });

  it('refuses an expired token or one for another resource with invalid_token', async () => {
    for (const token of [signAccessToken(SNAPSHOT, TARGET, -1).token, signAccessToken(SNAPSHOT, { ...TARGET, audience: 'https://other/mcp' }).token]) {
      expect(await authenticate(bearer(token))).toMatchObject({
        outcome: '401 invalid_token', challenge: `Bearer resource_metadata="${METADATA}", error="invalid_token"`,
      });
    }
  });

  it('refuses a token whose grant or person was revoked', async () => {
    const token = signAccessToken(SNAPSHOT, TARGET).token;
    markRevoked({ grantId: SNAPSHOT.grant_id });
    expect((await authenticate(bearer(token))).outcome).toBe('401 invalid_token');
    clearRevocations();
    markRevoked({ userId: USER });
    expect((await authenticate(bearer(token))).outcome).toBe('401 invalid_token');
  });

  it('passes other credentials to requireAuth, and challenges only when it refuses', async () => {
    const session = await authenticate(bearer(signToken({ userId: USER, role: 'member' })));
    expect(session).toMatchObject({ outcome: 'next', challenge: undefined });
    mocks.validateBotApiKey.mockResolvedValue({ user_id: USER, scopes: ['mcp:read'] });
    expect((await authenticate(bearer('lt_bot_abc'))).auth).toMatchObject({ principalType: 'bot' });
    expect(await authenticate()).toMatchObject({ outcome: '401 Unauthorized', challenge: `Bearer resource_metadata="${METADATA}"` });
  });
});

describe('revocation entries', () => {
  it('expire after one access-token lifetime', async () => {
    const { isRevoked } = await import('../../services/auth/oauth-server/revocations');
    const now = 1_000_000;
    markRevoked({ grantId: 'g1' }, now);
    expect(isRevoked({ gid: 'g1', sub: 'u' }, now + 1000)).toBe(true);
    expect(isRevoked({ gid: 'g1', sub: 'u' }, now + 301_000)).toBe(false);
  });
});
