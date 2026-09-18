import { describe, it, expect, vi, beforeEach } from 'vitest';

// The facet-selected form: write scope folds into the SDK's atomic selection
// as a role filter; with enforcing roles and a payload the row is picked
// first, validated against its schema, then written by asserted id.
const enforcing = vi.hoisted(() => ({ roles: new Set<string>() }));
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => enforcing.roles),
  getEnforcedFormSchema: vi.fn(async () => null),
}));
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({ escalationStrategyRegistry: { current: null } }));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(async () => 'eph-uuid-1'),
  formatEphemeralToken: (uuid: string, label: string) => `eph:v1:${label}:${uuid}`,
}));
vi.mock('../../workers', () => ({
  createClient: () => ({ workflow: { getHandle: vi.fn(), start: vi.fn() } }),
}));
vi.mock('../../services/escalation/resolver-validation', () => ({
  checkResolverPayload: vi.fn(async () => null),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { checkResolverPayload } from '../../services/escalation/resolver-validation';
import { accumulateItemByMetadata, removeItemByMetadata } from '../../api/escalations/accumulate';

const mockByMeta = vi.mocked(escalationService.accumulateItemByMetadata);
const mockById = vi.mocked(escalationService.accumulateItem);
const mockFind = vi.mocked(escalationService.findByMetadata);
const mockRemoveByMeta = vi.mocked(escalationService.removeAccumulatedItemByMetadata);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);
const mockEffectiveScope = vi.mocked(userService.effectiveScope);

/** A scoped caller holding write_all on the given roles. */
function scopedWriter(roles: string[]) {
  mockHasGlobal.mockResolvedValue(false);
  mockGetUserRoles.mockResolvedValue(roles.map((role) => ({ role, type: 'member', read_scope: 'all', write_scope: 'all' })) as any);
  mockEffectiveScope.mockReturnValue({ read: 'all', write: 'all' } as any);
}

const AUTH = { userId: 'user-uuid' };
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeBin(overrides: Record<string, any> = {}): any {
  return {
    id: BIN_ID, status: 'pending', role: 'bin', signal_key: 'sig-bin-1',
    assigned_to: null, assigned_until: null, workflow_id: 'wf-1', workflow_type: 'rollupBin', task_queue: 'q',
    metadata: { binKey: 'b-1', accumulate_count: 0, accumulate_max: 2, accumulate_keys: [] },
    envelope: JSON.stringify({ accumulate_items: {} }),
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  enforcing.roles = new Set();
  mockHasGlobal.mockResolvedValue(true);
});

describe('accumulateItemByMetadata (api)', () => {
  it('requires key, value, and itemKey', async () => {
    expect((await accumulateItemByMetadata({ key: '', value: 'v', itemKey: 'x' }, AUTH)).status).toBe(400);
    expect((await accumulateItemByMetadata({ key: 'k', value: 'v', itemKey: '' }, AUTH)).status).toBe(400);
    expect(mockByMeta).not.toHaveBeenCalled();
  });

  it('runs one atomic call with the scoped role filter when no role enforces', async () => {
    scopedWriter(['bin', 'other']);
    mockByMeta.mockResolvedValue({ outcome: 'accepted', count: 1, remaining: 1, escalation: makeBin() });
    const result = await accumulateItemByMetadata({ key: 'binKey', value: 'b-1', itemKey: 'bag-1', restrictRoles: ['bin'] }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ outcome: 'accepted', count: 1, remaining: 1, escalationId: BIN_ID });
    const [key, value, input] = mockByMeta.mock.calls[0];
    expect([key, value]).toEqual(['binKey', 'b-1']);
    expect(input.roles).toEqual(['bin']);
    expect(input.actor).toBe(AUTH.userId);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('maps a not-found selection to 404', async () => {
    mockByMeta.mockResolvedValue({ outcome: 'not-found', count: -1, remaining: null, escalation: null });
    expect((await accumulateItemByMetadata({ key: 'binKey', value: 'nope', itemKey: 'x' }, AUTH)).status).toBe(404);
  });

  it('with enforcing roles and a payload, picks the row, validates it, then writes by id', async () => {
    enforcing.roles = new Set(['bin']);
    mockFind.mockResolvedValue({ escalations: [makeBin()], total: 1 });
    mockById.mockResolvedValue({ outcome: 'completed', count: 2, remaining: 0, escalation: makeBin({ status: 'resolved' }) });
    const result = await accumulateItemByMetadata({ key: 'binKey', value: 'b-1', itemKey: 'bag-2', payload: { w: 2 } }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ outcome: 'completed', signaled: true, workflowId: 'wf-1' });
    expect(checkResolverPayload).toHaveBeenCalledTimes(1);
    expect(mockById.mock.calls[0][0]).toBe(BIN_ID);
    expect(mockByMeta).not.toHaveBeenCalled();
  });

  it('with enforcing roles but no payload, stays single-statement', async () => {
    enforcing.roles = new Set(['bin']);
    mockByMeta.mockResolvedValue({ outcome: 'accepted', count: 1, remaining: 1, escalation: makeBin() });
    await accumulateItemByMetadata({ key: 'binKey', value: 'b-1', itemKey: 'bag-1' }, AUTH);
    expect(mockByMeta).toHaveBeenCalledTimes(1);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('surfaces a row that went terminal between the two phases as 409', async () => {
    enforcing.roles = new Set(['bin']);
    mockFind.mockResolvedValue({ escalations: [makeBin()], total: 1 });
    mockById.mockResolvedValue({ outcome: 'not-found', count: -1, remaining: null, escalation: null });
    const result = await accumulateItemByMetadata({ key: 'binKey', value: 'b-1', itemKey: 'x', payload: {} }, AUTH);
    expect(result.status).toBe(409);
  });
});

describe('removeItemByMetadata (api)', () => {
  it('removes through the facet selector with the scoped roles', async () => {
    scopedWriter(['bin']);
    mockRemoveByMeta.mockResolvedValue({ outcome: 'removed', count: 0, escalation: makeBin() });
    const result = await removeItemByMetadata({ key: 'binKey', value: 'b-1', itemKey: 'bag-1' }, AUTH);
    expect(result.status).toBe(200);
    expect(mockRemoveByMeta.mock.calls[0][2]).toMatchObject({ itemKey: 'bag-1', roles: ['bin'], actor: AUTH.userId });
  });
});
