import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

// Characterization of the session tokens Long Tail issues today: their
// claims, algorithm and lifetime.

const mocks = vi.hoisted(() => ({
  verifyPassword: vi.fn(),
  ssoProvision: vi.fn(),
  ssoConfig: null as null | { resolve: (...args: unknown[]) => unknown },
}));

vi.mock('../../services/user', async (io) => ({
  ...(await io<typeof import('../../services/user')>()),
  verifyPassword: mocks.verifyPassword,
}));
vi.mock('../../services/user/sso-provision', () => ({ ssoProvision: mocks.ssoProvision }));
vi.mock('../../modules/sso', () => ({ getSSOConfig: () => mocks.ssoConfig }));

import { config } from '../../modules/config';
import { signToken } from '../../modules/auth';
import { login } from '../../api/auth';
import { exchangeSSO } from '../../api/auth-sso';

const SECRET = 'token-claims-secret';
const USER = '00000000-0000-4000-8000-0000000000f1';
const DAY_SECONDS = 86_400;
let savedSecret: string;

function decode(token: string): { header: jwt.JwtHeader; payload: Record<string, any> } {
  const { header, payload } = jwt.decode(token, { complete: true }) as jwt.Jwt;
  return { header, payload: payload as Record<string, any> };
}

beforeAll(() => {
  savedSecret = config.JWT_SECRET;
  (config as any).JWT_SECRET = SECRET;
});
afterAll(() => { (config as any).JWT_SECRET = savedSecret; });

describe('signToken', () => {
  it('signs HS256 with the configured secret and a 24 hour default lifetime', () => {
    const token = signToken({ userId: USER });
    const { header, payload } = decode(token);
    expect(header.alg).toBe('HS256');
    expect(payload.exp - payload.iat).toBe(DAY_SECONDS);
    expect(() => jwt.verify(token, SECRET)).not.toThrow();
  });

  it('adds only iat and exp to the payload: no aud, iss or sub', () => {
    const { payload } = decode(signToken({ userId: USER, role: 'member' }));
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'userId']);
  });
});

describe('password login token', () => {
  const ROLES = [
    { role: 'reviewer', type: 'member', read_scope: 'all', write_scope: 'none' },
    { role: 'ops', type: 'admin', read_scope: 'all', write_scope: 'all' },
  ];

  it('carries userId, the highest role type and role/type pairs only, for 24 hours', async () => {
    mocks.verifyPassword.mockResolvedValue({ id: USER, external_id: 'probe', display_name: 'Probe', roles: ROLES });
    const result = await login({ username: 'probe', password: 'pw' });
    const { payload } = decode(result.data.token);
    expect(payload).toMatchObject({
      userId: USER,
      role: 'admin',
      roles: [{ role: 'reviewer', type: 'member' }, { role: 'ops', type: 'admin' }],
    });
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'roles', 'userId']);
    expect(payload.exp - payload.iat).toBe(DAY_SECONDS);
  });

  it('derives the role claim as superadmin over admin over member', async () => {
    const roleFor = async (types: string[]) => {
      mocks.verifyPassword.mockResolvedValue({ id: USER, roles: types.map((type, i) => ({ role: `r${i}`, type })) });
      return decode((await login({ username: 'probe', password: 'pw' })).data.token).payload.role;
    };
    expect(await roleFor(['member', 'superadmin', 'admin'])).toBe('superadmin');
    expect(await roleFor(['member', 'admin'])).toBe('admin');
    expect(await roleFor(['member'])).toBe('member');
    expect(await roleFor([])).toBe('member');
  });
});

describe('SSO exchange token', () => {
  it('carries userId, the highest role type, the provisioned roles as given and sso: true, for 24 hours', async () => {
    const roles = [{ role: 'floor', type: 'member', read_scope: 'self', write_scope: 'self' }];
    mocks.ssoConfig = { resolve: vi.fn(async () => ({ externalId: 'host-user' })) };
    mocks.ssoProvision.mockResolvedValue({ userId: USER, roles, created: false });
    const result = await exchangeSSO({ headers: {} } as any);
    const { payload } = decode(result.data.token);
    expect(payload).toMatchObject({ userId: USER, role: 'member', roles, sso: true });
    expect(payload.exp - payload.iat).toBe(DAY_SECONDS);
  });
});
