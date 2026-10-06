import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/user', () => ({
  getUserByMetadataValue: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('../../services/iam/ephemeral', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  storeEphemeral: vi.fn(),
  consumeEphemeral: vi.fn(),
  peekEphemeral: vi.fn(),
  revokeEphemeral: vi.fn(),
}));
vi.mock('../../api/escalations/helpers', () => ({
  getEscalationWriteScope: vi.fn(),
}));
vi.mock('../../api/scan-codes/badge-policy', () => ({
  stationGrantPolicy: vi.fn(),
}));

import * as userService from '../../services/user';
import * as ephemeral from '../../services/iam/ephemeral';
import { getEscalationWriteScope } from '../../api/escalations/helpers';
import { stationGrantPolicy } from '../../api/scan-codes/badge-policy';
import {
  executeIdentityScan,
  resolveActingAuth,
  actingIdentitySatisfied,
} from '../../api/scan-codes/identity';
import { SCAN_OUTCOMES } from '../../types';

const users = vi.mocked(userService);
const eph = vi.mocked(ephemeral);
const writeScope = vi.mocked(getEscalationWriteScope);

const UUID = '01234567-89ab-4cde-8f01-23456789abcd';
const scheme = {
  version: 12, name: 'Associate badge', target_facet: 'badge_id',
  kind: 'identity', grant_ttl_seconds: 300, grant_max_uses: 0,
} as any;
const rule = {
  scheme_version: 12, category: '0', name: 'Badge',
  steps: [], fallback: { markdown: 'Badge not recognized.' }, notPrimed: {},
} as any;
const parsed = { version: 12, category: '0', target: 'BADGE-TOKEN-1' };

beforeEach(() => vi.clearAllMocks());

describe('executeIdentityScan', () => {
  it('mints a grant through the keystore under the scheme policy', async () => {
    users.getUserByMetadataValue.mockResolvedValue({ id: 'user-1', display_name: 'Maria', external_id: 'maria' } as any);
    eph.storeEphemeral.mockResolvedValue(UUID);

    const result = await executeIdentityScan(parsed, scheme, rule);
    expect(users.getUserByMetadataValue).toHaveBeenCalledWith('badge_id', 'BADGE-TOKEN-1');
    expect(eph.storeEphemeral).toHaveBeenCalledWith('user-1', {
      ttlSeconds: 300, maxUses: 0, label: 'acting_identity', bindOnUse: false,
    });
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.IDENTITY_PRIMED);
    expect(result.data?.actor).toEqual({ id: 'user-1', displayName: 'Maria' });
    expect(result.data?.actingToken).toBe(`eph:v1:acting_identity:${UUID}`);
    expect(result.data?.expiresAt).toBeDefined();
    // the client learns the grant's shape so a single-shot grant never outlives its use
    expect(result.data?.maxUses).toBe(0);
  });

  it('reports a single-shot policy as maxUses 1', async () => {
    users.getUserByMetadataValue.mockResolvedValue({ id: 'user-1', display_name: 'Maria', external_id: 'maria' } as any);
    eph.storeEphemeral.mockResolvedValue(UUID);
    const result = await executeIdentityScan(parsed, { ...scheme, grant_max_uses: 1 }, rule);
    expect(eph.storeEphemeral).toHaveBeenCalledWith('user-1', expect.objectContaining({ maxUses: 1 }));
    expect(result.data?.maxUses).toBe(1);
  });

  it('an unknown badge is IDENTITY_UNKNOWN with the rule fallback — never a lookup by external_id', async () => {
    users.getUserByMetadataValue.mockResolvedValue(null);
    const result = await executeIdentityScan(parsed, scheme, rule);
    expect(result.data?.outcome).toBe(SCAN_OUTCOMES.IDENTITY_UNKNOWN);
    expect(result.data?.fallback).toEqual({ markdown: 'Badge not recognized.' });
    expect(eph.storeEphemeral).not.toHaveBeenCalled();
  });

  it('best-effort revokes the grant being replaced, label-checked', async () => {
    users.getUserByMetadataValue.mockResolvedValue({ id: 'user-1', display_name: 'M', external_id: 'm' } as any);
    eph.storeEphemeral.mockResolvedValue(UUID);
    eph.revokeEphemeral.mockResolvedValue(true);

    await executeIdentityScan(parsed, scheme, rule, `eph:v1:acting_identity:${UUID}`);
    expect(eph.revokeEphemeral).toHaveBeenCalledWith(UUID);

    eph.revokeEphemeral.mockClear();
    await executeIdentityScan(parsed, scheme, rule, `eph:v1:llm_password:${UUID}`);
    expect(eph.revokeEphemeral).not.toHaveBeenCalled(); // wrong label — untouched
  });
});

describe('executeIdentityScan — the station decides the policy', () => {
  it('mints under the station role\'s policy and tells the device', async () => {
    users.getUserByMetadataValue.mockResolvedValue({ id: 'user-1', display_name: 'Maria', external_id: 'maria' } as any);
    eph.storeEphemeral.mockResolvedValue(UUID);
    vi.mocked(stationGrantPolicy).mockResolvedValue({ ttlSeconds: 600, maxUses: 0, scope: 'action', role: 'binning-associate' });

    const result = await executeIdentityScan(parsed, scheme, rule, undefined, { userId: 'station-1', stationRole: 'binning-associate' });
    expect(stationGrantPolicy).toHaveBeenCalledWith(scheme, 'station-1', 'binning-associate');
    expect(eph.storeEphemeral).toHaveBeenCalledWith('user-1', {
      ttlSeconds: 600, maxUses: 0, label: 'acting_identity', bindOnUse: false,
    });
    expect(result.data).toMatchObject({ maxUses: 0, grantScope: 'action' });
    expect(Date.parse(result.data!.expiresAt!) - Date.now()).toBeGreaterThan(590_000);
  });
});

describe('resolveActingAuth', () => {
  it('spends a live grant and acts as its person', async () => {
    eph.consumeEphemeral.mockResolvedValue({ value: 'user-1', remaining: 0, bound: false });
    users.getUser.mockResolvedValue({ id: 'user-1', status: 'active' } as any);
    const result = await resolveActingAuth(`eph:v1:acting_identity:${UUID}`);
    expect(result).toEqual({
      ok: true, auth: { userId: 'user-1' }, grant: { consumed: true, remaining: 0, bound: false },
    });
    expect(eph.consumeEphemeral).toHaveBeenCalledWith(UUID, null);
  });

  it('rejects wrong-label tokens without touching the keystore', async () => {
    const result = await resolveActingAuth(`eph:v1:llm_password:${UUID}`);
    expect(result.ok).toBe(false);
    expect(eph.consumeEphemeral).not.toHaveBeenCalled();
  });

  it('a dead grant or inactive user is a loud failure, never a fallback', async () => {
    eph.consumeEphemeral.mockResolvedValue(null);
    expect((await resolveActingAuth(`eph:v1:acting_identity:${UUID}`)).ok).toBe(false);

    eph.consumeEphemeral.mockResolvedValue({ value: 'user-1', remaining: null, bound: false });
    users.getUser.mockResolvedValue({ id: 'user-1', status: 'suspended' } as any);
    expect((await resolveActingAuth(`eph:v1:acting_identity:${UUID}`)).ok).toBe(false);
  });
});

describe('actingIdentitySatisfied', () => {
  const ctx = (acting: boolean) => ({
    acting, stationAuth: { userId: 'station-1' },
  }) as any;

  it('a primed grant always satisfies', async () => {
    expect(await actingIdentitySatisfied({ query: {} }, ctx(true))).toBe(true);
    expect(writeScope).not.toHaveBeenCalled();
  });

  it('a write-capable login self-satisfies within the step roles', async () => {
    writeScope.mockResolvedValue({ global: false, allRoles: ['gluing'], selfRoles: [] } as any);
    expect(await actingIdentitySatisfied({ query: { roles: ['gluing'] } }, ctx(false))).toBe(true);
  });

  it('a write-none station account can never self-satisfy', async () => {
    writeScope.mockResolvedValue({ global: false, allRoles: [], selfRoles: [] } as any);
    expect(await actingIdentitySatisfied({ query: {} }, ctx(false))).toBe(false);
  });

  it('write scope outside the step roles does not satisfy', async () => {
    writeScope.mockResolvedValue({ global: false, allRoles: ['packing'], selfRoles: [] } as any);
    expect(await actingIdentitySatisfied({ query: { roles: ['gluing'] } }, ctx(false))).toBe(false);
  });
});
