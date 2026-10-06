import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/user', () => ({ getUser: vi.fn() }));
vi.mock('../../services/role', () => ({ getRoleProperties: vi.fn() }));

import * as userService from '../../services/user';
import * as roleService from '../../services/role';
import { stationGrantPolicy } from '../../api/scan-codes/badge-policy';
import type { ScanScheme } from '../../types';

const users = vi.mocked(userService);
const roles = vi.mocked(roleService);

const BADGE: ScanScheme = {
  version: 12, name: 'Badge', description: null, target_facet: 'badge_id', encoding: 'delimited', delimiter: ':',
  target_length: null, kind: 'identity', grant_ttl_seconds: 60, grant_max_uses: 1, grant_scope: 'action', enabled: true,
};
const station = (...memberOf: string[]) => ({ id: 'station-1', roles: memberOf.map((role) => ({ role })) }) as any;
const props: Record<string, Record<string, unknown>> = {
  'binning-associate': { kiosk: true, badge_grant: { ttl_seconds: 600, max_uses: 0 } },
  'shipping-associate': { kiosk: true, badge_grant: { ttl_seconds: 300, max_uses: 0 } },
  gluer: { kiosk: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  roles.getRoleProperties.mockImplementation(async (role: string) => props[role] ?? null);
});

describe('stationGrantPolicy', () => {
  it('a station without a role policy mints under the badge scheme (one act per scan)', async () => {
    users.getUser.mockResolvedValue(station('gluer'));
    expect(await stationGrantPolicy(BADGE, 'station-1')).toEqual({ ttlSeconds: 60, maxUses: 1, scope: 'action' });
  });

  it('a binning station mints ten minutes of unlimited acts; unset fields keep the scheme value', async () => {
    users.getUser.mockResolvedValue(station('binning-associate', 'gluer'));
    expect(await stationGrantPolicy(BADGE, 'station-1')).toEqual({
      ttlSeconds: 600, maxUses: 0, scope: 'action', role: 'binning-associate',
    });
  });

  it('a device with two policies uses the role it is locked to', async () => {
    users.getUser.mockResolvedValue(station('binning-associate', 'shipping-associate'));
    expect((await stationGrantPolicy(BADGE, 'station-1', 'shipping-associate')).ttlSeconds).toBe(300);
    expect((await stationGrantPolicy(BADGE, 'station-1', 'binning-associate')).ttlSeconds).toBe(600);
  });

  it('two policies with no locked role, or a locked role it does not hold, fall to the scheme', async () => {
    users.getUser.mockResolvedValue(station('binning-associate', 'shipping-associate'));
    expect(await stationGrantPolicy(BADGE, 'station-1')).toEqual({ ttlSeconds: 60, maxUses: 1, scope: 'action' });
    expect((await stationGrantPolicy(BADGE, 'station-1', 'admin')).ttlSeconds).toBe(60);
  });
});
