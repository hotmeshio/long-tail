import { describe, it, expect, vi, beforeEach } from 'vitest';

// The signal-key ingress form: write scope collapses to 404 non-disclosure,
// no claim assertion, same shape gate and outcome mapping as the by-id form.
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set<string>()),
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

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { accumulateItemBySignalKey, removeItemBySignalKey } from '../../api/escalations/accumulate';

const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockAdd = vi.mocked(escalationService.accumulateItemBySignalKey);
const mockRemove = vi.mocked(escalationService.removeAccumulatedItemBySignalKey);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);

const AUTH = { userId: 'user-uuid' };
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeBin(overrides: Record<string, any> = {}): any {
  return {
    id: BIN_ID, status: 'pending', role: 'bin', signal_key: 'sig-bin-1',
    assigned_to: null, assigned_until: null, workflow_id: 'wf-1', workflow_type: 'rollupBin', task_queue: 'q',
    metadata: { accumulate_count: 0, accumulate_max: null, accumulate_keys: [] },
    envelope: JSON.stringify({ accumulate_items: {} }),
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
});

describe('accumulateItemBySignalKey (api)', () => {
  it('requires signalKey and itemKey', async () => {
    expect((await accumulateItemBySignalKey({ signalKey: '', itemKey: 'x' }, AUTH)).status).toBe(400);
    expect((await accumulateItemBySignalKey({ signalKey: 'sig', itemKey: '' }, AUTH)).status).toBe(400);
    expect(mockGetBySignalKey).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown key and 409 for a terminal row', async () => {
    mockGetBySignalKey.mockResolvedValue(null);
    expect((await accumulateItemBySignalKey({ signalKey: 'sig', itemKey: 'x' }, AUTH)).status).toBe(404);
    mockGetBySignalKey.mockResolvedValue(makeBin({ status: 'expired' }));
    expect((await accumulateItemBySignalKey({ signalKey: 'sig', itemKey: 'x' }, AUTH)).status).toBe(409);
  });

  it('collapses a write-scope denial to 404 non-disclosure', async () => {
    mockHasGlobal.mockResolvedValue(false);
    vi.mocked(userService.getRoleScope).mockResolvedValue({ allRoles: [], selfRoles: [] } as any);
    mockGetBySignalKey.mockResolvedValue(makeBin());
    const result = await accumulateItemBySignalKey({ signalKey: 'sig-bin-1', itemKey: 'x' }, AUTH);
    expect(result.status).toBe(404);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('adds without a claim assertion and reports an unbounded remaining as null', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue({ outcome: 'accepted', count: 1, remaining: null, escalation: makeBin() });
    const result = await accumulateItemBySignalKey({ signalKey: 'sig-bin-1', itemKey: 'bag-1', payload: { w: 1 } }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ outcome: 'accepted', count: 1, remaining: null });
    const [signalKey, input] = mockAdd.mock.calls[0];
    expect(signalKey).toBe('sig-bin-1');
    expect(input).toMatchObject({ itemKey: 'bag-1', payload: { w: 1 }, actor: AUTH.userId });
    expect('assertClaim' in input).toBe(false);
  });
});

describe('removeItemBySignalKey (api)', () => {
  it('removes through the signal key with non-disclosure on denial', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBin());
    mockRemove.mockResolvedValue({ outcome: 'removed', count: 0, escalation: makeBin() });
    const result = await removeItemBySignalKey({ signalKey: 'sig-bin-1', itemKey: 'bag-1' }, AUTH);
    expect(result.status).toBe(200);
    expect(mockRemove.mock.calls[0][0]).toBe('sig-bin-1');

    mockHasGlobal.mockResolvedValue(false);
    vi.mocked(userService.getRoleScope).mockResolvedValue({ allRoles: [], selfRoles: [] } as any);
    expect((await removeItemBySignalKey({ signalKey: 'sig-bin-1', itemKey: 'bag-1' }, AUTH)).status).toBe(404);
  });
});
