import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../../services/user/sso-provision', () => ({
  ssoProvision: vi.fn().mockResolvedValue({
    userId: 'user-1',
    roles: [{ role: 'member', type: 'member' }],
    created: false,
  }),
}));

import { config } from '../../modules/config';
import { requireAuth } from '../../modules/auth';
import { setSSOConfig, clearSSOConfig } from '../../modules/sso';

function mockReqRes() {
  const req = { headers: {}, auth: undefined } as any;
  const res = {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    json() { /* sink */ },
  } as any;
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, wasNextCalled: () => nextCalled };
}

describe('requireAuth — SSO fallback never slides the host session', () => {
  beforeAll(() => {
    (config as any).JWT_SECRET = 'test-secret-key';
  });

  afterEach(() => clearSSOConfig());

  it('calls resolve with the request ONLY — no response handle on the ambient path', async () => {
    let capturedArgs: unknown[] = [];
    setSSOConfig({
      resolve: (...args: unknown[]) => {
        capturedArgs = args;
        return null;
      },
    } as any);

    const { req, res, next } = mockReqRes();
    await requireAuth(req, res, next);

    // Ambient cookie-bearing API traffic must never receive `res` — only the
    // explicit exchange (login + gated keepalive beat) slides the host session.
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).toBe(req);
  });

  it('authenticates the request when resolve returns an identity', async () => {
    setSSOConfig({ resolve: () => ({ externalId: 'host-user' }) });
    const { req, res, next, wasNextCalled } = mockReqRes();
    await requireAuth(req, res, next);
    expect(wasNextCalled()).toBe(true);
    expect(req.auth?.sso).toBe(true);
  });

  it('a throwing resolve falls through to 401', async () => {
    setSSOConfig({ resolve: () => { throw new Error('boom'); } });
    const { req, res, next, wasNextCalled } = mockReqRes();
    await requireAuth(req, res, next);
    expect(wasNextCalled()).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
