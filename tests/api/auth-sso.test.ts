import { describe, it, expect, vi, beforeEach } from 'vitest';

let ssoConfig: any = null;
vi.mock('../../modules/sso', () => ({
  getSSOConfig: () => ssoConfig,
}));
vi.mock('../../services/user/sso-provision', () => ({
  ssoProvision: vi.fn().mockResolvedValue({
    userId: 'user-1',
    roles: [{ role: 'member', type: 'member' }],
    created: false,
  }),
}));
vi.mock('../../modules/auth', () => ({
  signToken: vi.fn(() => 'signed-token'),
}));

import { exchangeSSO } from '../../api/auth-sso';

beforeEach(() => {
  ssoConfig = null;
});

describe('exchangeSSO — resolve receives the response handle', () => {
  it('forwards the exact res object to resolve', async () => {
    const resolve = vi.fn().mockResolvedValue({ externalId: 'u1' });
    ssoConfig = { resolve };
    const req = { headers: {} } as any;
    const res = { setHeader: vi.fn() } as any;

    const result = await exchangeSSO(req, res);
    expect(result.status).toBe(200);
    expect(resolve).toHaveBeenCalledWith(req, res);
  });

  it('a one-parameter resolve keeps working (back-compat)', async () => {
    ssoConfig = { resolve: (_req: any) => ({ externalId: 'u1' }) };
    const result = await exchangeSSO({ headers: {} } as any, {} as any);
    expect(result.status).toBe(200);
    expect(result.data.token).toBe('signed-token');
  });

  it('resolve throwing yields 500 — the keepalive treats it as retry, not logout', async () => {
    ssoConfig = { resolve: () => { throw new Error('host re-mint failed'); } };
    const result = await exchangeSSO({ headers: {} } as any, {} as any);
    expect(result.status).toBe(500);
    expect(result.error).toBe('host re-mint failed');
  });

  it('404 when SSO is not configured', async () => {
    const result = await exchangeSSO({ headers: {} } as any);
    expect(result.status).toBe(404);
  });
});
