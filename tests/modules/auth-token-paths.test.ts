import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Characterization of requireAuth exactly as it behaves today: the outcome of
// every credential path and the lookups each path makes.

const mocks = vi.hoisted(() => ({
  validateBotApiKey: vi.fn(),
  resolvePrincipal: vi.fn(),
  ssoProvision: vi.fn(),
  ssoConfig: null as null | { resolve: (...args: unknown[]) => unknown },
}));

vi.mock('../../services/auth/bot-api-key', () => ({ validateBotApiKey: mocks.validateBotApiKey }));
vi.mock('../../services/iam/principal', () => ({ resolvePrincipal: mocks.resolvePrincipal }));
vi.mock('../../services/user/sso-provision', () => ({ ssoProvision: mocks.ssoProvision }));
vi.mock('../../modules/sso', () => ({ getSSOConfig: () => mocks.ssoConfig }));

import { config } from '../../modules/config';
import { requireAuth, setAuthAdapter } from '../../modules/auth';
import { createDelegationToken } from '../../services/auth/delegation';

const SECRET = 'token-paths-secret';
const USER = '00000000-0000-4000-8000-0000000000e1';
let savedSecret: string;

async function authenticate(authorization?: string): Promise<{ outcome: string; auth?: Record<string, unknown> }> {
  const req = { headers: { authorization } } as any;
  let outcome = 'no response';
  const res = {
    status(code: number) { this.code = code; return this; },
    json(body: { error: string }) { outcome = `${this.code} ${body.error}`; },
  } as any;
  await requireAuth(req, res, () => { outcome = 'next'; });
  return { outcome, auth: req.auth };
}

const bearer = (token: string) => `Bearer ${token}`;
const sign = (payload: object, options: jwt.SignOptions = {}) => jwt.sign(payload, SECRET, options);

beforeAll(() => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = SECRET;
});
afterAll(() => { (config as any).JWT_SECRET = savedSecret; });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ssoConfig = null;
});

function expectNoLookups(): void {
  expect(mocks.validateBotApiKey).not.toHaveBeenCalled();
  expect(mocks.resolvePrincipal).not.toHaveBeenCalled();
  expect(mocks.ssoProvision).not.toHaveBeenCalled();
}

describe('requireAuth: JWT bearer', () => {
  it('accepts a valid token as the decoded payload, including iat and exp, with no lookup', async () => {
    const { outcome, auth } = await authenticate(bearer(sign({ userId: USER, role: 'member', roles: [] }, { expiresIn: '1h' })));
    expect(outcome).toBe('next');
    expect(auth).toMatchObject({ userId: USER, role: 'member', roles: [] });
    expect((auth!.exp as number) - (auth!.iat as number)).toBe(3600);
    expectNoLookups();
  });

  it('answers an expired token with 401 Token expired', async () => {
    const token = sign({ userId: USER, exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await authenticate(bearer(token))).outcome).toBe('401 Token expired');
  });

  it('answers a bad signature or garbage with 401 Unauthorized', async () => {
    expect((await authenticate(bearer(jwt.sign({ userId: USER }, 'other-secret')))).outcome).toBe('401 Unauthorized');
    expect((await authenticate(bearer('not-a-jwt'))).outcome).toBe('401 Unauthorized');
  });

  it('answers a valid token without userId with 401 Token missing required userId claim', async () => {
    expect((await authenticate(bearer(sign({ sub: USER })))).outcome).toBe('401 Token missing required userId claim');
  });

  it('refuses same-secret delegation and file-download tokens only for lacking userId', async () => {
    const delegation = createDelegationToken(USER, ['escalations:read']);
    const fileDownload = sign({ filePath: 'a.txt', purpose: 'file-download' }, { expiresIn: 60 });
    expect((await authenticate(bearer(delegation))).outcome).toBe('401 Token missing required userId claim');
    expect((await authenticate(bearer(fileDownload))).outcome).toBe('401 Token missing required userId claim');
  });

  it('trusts the role claim as signed, with no lookup', async () => {
    const { auth } = await authenticate(bearer(sign({ userId: USER, role: 'superadmin' })));
    expect(auth!.role).toBe('superadmin');
    expectNoLookups();
  });

  it('rejects every token when the secret is empty', async () => {
    const token = sign({ userId: USER });
    (config as any).JWT_SECRET = '';
    try {
      expect((await authenticate(bearer(token))).outcome).toBe('401 Unauthorized');
    } finally {
      (config as any).JWT_SECRET = SECRET;
    }
  });

  it('never falls back to SSO when a bearer is present, even an invalid one', async () => {
    const resolve = vi.fn(async () => ({ externalId: 'host-user' }));
    mocks.ssoConfig = { resolve };
    expect((await authenticate(bearer('not-a-jwt'))).outcome).toBe('401 Unauthorized');
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('requireAuth: bot API key', () => {
  it('resolves the key and the principal once each, and builds a bot payload', async () => {
    mocks.validateBotApiKey.mockResolvedValue({ user_id: USER, scopes: ['mcp:read'] });
    mocks.resolvePrincipal.mockResolvedValue({ roleType: 'admin' });
    const { outcome, auth } = await authenticate(bearer('lt_bot_abc'));
    expect(outcome).toBe('next');
    expect(auth).toEqual({ userId: USER, role: 'admin', scopes: ['mcp:read'], principalType: 'bot' });
    expect(mocks.validateBotApiKey).toHaveBeenCalledTimes(1);
    expect(mocks.resolvePrincipal).toHaveBeenCalledTimes(1);
  });

  it('defaults the role to member and the scopes to none', async () => {
    mocks.validateBotApiKey.mockResolvedValue({ user_id: USER, scopes: null });
    mocks.resolvePrincipal.mockResolvedValue(null);
    expect((await authenticate(bearer('lt_bot_abc'))).auth).toEqual({ userId: USER, role: 'member', scopes: [], principalType: 'bot' });
  });

  it('answers an unknown or failing key with 401 Unauthorized', async () => {
    mocks.validateBotApiKey.mockResolvedValueOnce(null);
    expect((await authenticate(bearer('lt_bot_unknown'))).outcome).toBe('401 Unauthorized');
    mocks.validateBotApiKey.mockRejectedValueOnce(new Error('db down'));
    expect((await authenticate(bearer('lt_bot_abc'))).outcome).toBe('401 Unauthorized');
  });
});

describe('requireAuth: SSO fallback (no bearer)', () => {
  it('provisions the host identity and takes the highest role type', async () => {
    mocks.ssoConfig = { resolve: vi.fn(async () => ({ externalId: 'host-user' })) };
    mocks.ssoProvision.mockResolvedValue({ userId: USER, roles: [{ role: 'a', type: 'member' }, { role: 'b', type: 'admin' }] });
    const { outcome, auth } = await authenticate();
    expect(outcome).toBe('next');
    expect(auth).toEqual({ userId: USER, role: 'admin', roles: [{ role: 'a', type: 'member' }, { role: 'b', type: 'admin' }], sso: true });
  });

  it('answers no identity, or no SSO at all, with 401 Unauthorized', async () => {
    mocks.ssoConfig = { resolve: vi.fn(async () => null) };
    expect((await authenticate()).outcome).toBe('401 Unauthorized');
    mocks.ssoConfig = null;
    expect((await authenticate()).outcome).toBe('401 Unauthorized');
    expect(mocks.ssoProvision).not.toHaveBeenCalled();
  });
});

describe('requireAuth: custom adapter via setAuthAdapter', () => {
  it('replaces the JWT and bot-key paths for bearer requests and is the no-SSO fallback', async () => {
    const authenticateFn = vi.fn(() => ({ userId: 'custom-user' }));
    setAuthAdapter({ authenticate: authenticateFn });
    expect((await authenticate(bearer('lt_bot_abc'))).auth).toEqual({ userId: 'custom-user' });
    expect((await authenticate()).auth).toEqual({ userId: 'custom-user' });
    expect(authenticateFn).toHaveBeenCalledTimes(2);
    expect(mocks.validateBotApiKey).not.toHaveBeenCalled();
  });
});
