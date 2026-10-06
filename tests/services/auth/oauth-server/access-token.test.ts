import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../../../services/auth/bot-api-key', () => ({ validateBotApiKey: vi.fn() }));
vi.mock('../../../../modules/sso', () => ({ getSSOConfig: () => null }));

import { config } from '../../../../modules/config';
import { requireAuth, signToken } from '../../../../modules/auth';
import { createDelegationToken } from '../../../../services/auth/delegation';
import {
  signAccessToken, verifyAccessToken, accessTokenPrincipal, ACCESS_TOKEN_TYPE,
} from '../../../../services/auth/oauth-server';
import type { LTGrantSnapshot } from '../../../../types';

const SECRET = 'access-token-secret';
const TARGET = { issuer: 'http://localhost:3000', audience: 'http://localhost:3000/mcp' };
const USER = '00000000-0000-4000-8000-0000000000a9';
const SNAPSHOT: LTGrantSnapshot = {
  grant_id: '00000000-0000-4000-8000-0000000000b9', user_id: USER, client_id: 'ltc_client',
  policy: { preset: 'read_only' }, scope: 'mcp:read',
  roles: [
    { role: 'reviewer', type: 'member', read_scope: 'all', write_scope: 'none' },
    { role: 'ops', type: 'admin', read_scope: 'all', write_scope: 'all' },
  ],
};
let savedSecret: string;

beforeAll(() => { savedSecret = config.JWT_SECRET; (config as any).JWT_SECRET = SECRET; });
afterAll(() => { (config as any).JWT_SECRET = savedSecret; });

describe('access tokens', () => {
  it('carry the grant, the roles and the target, for the configured lifetime', () => {
    const { token, expiresIn } = signAccessToken(SNAPSHOT, TARGET, 300);
    const decoded = jwt.decode(token, { complete: true })!;
    const claims = decoded.payload as Record<string, any>;
    expect(expiresIn).toBe(300);
    expect(decoded.header).toMatchObject({ alg: 'HS256', typ: ACCESS_TOKEN_TYPE });
    expect(claims).toMatchObject({
      iss: TARGET.issuer, aud: TARGET.audience, sub: USER, client_id: 'ltc_client',
      gid: SNAPSHOT.grant_id, scope: 'mcp:read', policy: { preset: 'read_only' }, roles: SNAPSHOT.roles,
    });
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims).not.toHaveProperty('userId');
  });

  it('verify returns the claims for the right issuer and audience', () => {
    const { token } = signAccessToken(SNAPSHOT, TARGET);
    expect(verifyAccessToken(token, TARGET)).toMatchObject({ sub: USER, gid: SNAPSHOT.grant_id });
  });

  it('verify refuses another audience or issuer', () => {
    const { token } = signAccessToken(SNAPSHOT, TARGET);
    expect(verifyAccessToken(token, { ...TARGET, audience: 'http://other/mcp' })).toBeNull();
    expect(verifyAccessToken(token, { ...TARGET, issuer: 'http://other' })).toBeNull();
  });

  it('verify refuses an expired token or another secret', () => {
    const { token } = signAccessToken(SNAPSHOT, TARGET, -1);
    expect(verifyAccessToken(token, TARGET)).toBeNull();
    const forged = jwt.sign({ gid: 'g', client_id: 'c', roles: [] }, 'other-secret', {
      header: { alg: 'HS256', typ: ACCESS_TOKEN_TYPE }, issuer: TARGET.issuer, audience: TARGET.audience, subject: USER,
    });
    expect(verifyAccessToken(forged, TARGET)).toBeNull();
  });

  it('verify refuses the other tokens signed with the same secret', () => {
    const session = signToken({ userId: USER, role: 'superadmin' });
    const delegation = createDelegationToken(USER, ['mcp:full']);
    const untyped = jwt.sign({ gid: 'g', client_id: 'c', roles: [] }, SECRET, {
      issuer: TARGET.issuer, audience: TARGET.audience, subject: USER,
    });
    for (const token of [session, delegation, untyped]) expect(verifyAccessToken(token, TARGET)).toBeNull();
  });

  it('signing fails loudly without a secret', () => {
    (config as any).JWT_SECRET = '';
    try {
      expect(() => signAccessToken(SNAPSHOT, TARGET)).toThrow('JWT_SECRET is not configured');
      expect(verifyAccessToken('anything', TARGET)).toBeNull();
    } finally {
      (config as any).JWT_SECRET = SECRET;
    }
  });

  it('requireAuth refuses an access token, so it never works on /api', async () => {
    const { token } = signAccessToken(SNAPSHOT, TARGET);
    let outcome = 'no response';
    const res = {
      status(code: number) { this.code = code; return this; },
      json(body: { error: string }) { outcome = `${this.code} ${body.error}`; },
    } as any;
    await requireAuth({ headers: { authorization: `Bearer ${token}` } } as any, res, () => { outcome = 'next'; });
    expect(outcome).toBe('401 Token missing required userId claim');
  });

  it('the principal names the person with their highest role type and the grant', () => {
    const claims = verifyAccessToken(signAccessToken(SNAPSHOT, TARGET).token, TARGET)!;
    expect(accessTokenPrincipal(claims, SNAPSHOT)).toEqual({
      userId: USER, role: 'admin',
      roles: [{ role: 'reviewer', type: 'member' }, { role: 'ops', type: 'admin' }],
      scopes: ['mcp:read'], principalType: 'oauth', clientId: 'ltc_client', grantId: SNAPSHOT.grant_id,
      policy: { preset: 'read_only' }, grantRoles: SNAPSHOT.roles,
    });
  });

  it('the principal takes roles, policy and scope from the live grant', () => {
    const claims = verifyAccessToken(signAccessToken(SNAPSHOT, TARGET).token, TARGET)!;
    const live = { ...SNAPSHOT, scope: 'mcp:full', policy: { preset: 'just_me' as const }, roles: [{ role: 'reviewer', type: 'member' as const, read_scope: 'all' as const, write_scope: 'none' as const }] };
    expect(accessTokenPrincipal(claims, live)).toMatchObject({
      role: 'member', roles: [{ role: 'reviewer', type: 'member' }], scopes: ['mcp:full'], policy: { preset: 'just_me' },
    });
  });

  it('a token without exp is refused', () => {
    const forever = jwt.sign(
      { client_id: 'ltc_client', gid: SNAPSHOT.grant_id, scope: 'mcp:read', policy: { preset: 'read_only' }, roles: [] },
      SECRET,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: ACCESS_TOKEN_TYPE }, issuer: TARGET.issuer, audience: TARGET.audience, subject: USER },
    );
    expect(verifyAccessToken(forever, TARGET)).toBeNull();
  });
});
