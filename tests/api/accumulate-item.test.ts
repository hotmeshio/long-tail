import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked decision-tree coverage for the by-id accumulate surface: input and
// shape gates, hybrid RBAC, payload validation, reciprocal gating, and the
// outcome-to-HTTP mapping. The enforcing set is empty so validation is a
// zero-read no-op here.
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
import { accumulateItem, removeItem, getEscalationItems } from '../../api/escalations/accumulate';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockAdd = vi.mocked(escalationService.accumulateItem);
const mockRemove = vi.mocked(escalationService.removeAccumulatedItem);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);

const AUTH = { userId: 'user-uuid' };
const BIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeBin(overrides: Record<string, any> = {}): any {
  return {
    id: BIN_ID,
    status: 'pending',
    role: 'bin',
    signal_key: 'sig-bin-1',
    assigned_to: null,
    assigned_until: null,
    workflow_id: 'wf-1',
    workflow_type: 'rollupBin',
    task_queue: 'long-tail-examples',
    metadata: { accumulate_count: 1, accumulate_max: 3, accumulate_keys: ['bag-1'] },
    envelope: JSON.stringify({
      accumulate_items: { 'bag-1': { at: '2026-01-01T00:00:01Z', payload: { w: 1 } } },
      accumulate_config: { unique: true, resolveAtMax: true },
    }),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const accepted = (count: number, remaining: number | null): any => ({
  outcome: 'accepted', count, remaining, escalation: makeBin(),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
});

describe('accumulateItem (api) — input and shape gates', () => {
  it('rejects a missing itemKey with 400 before any read', async () => {
    const result = await accumulateItem({ id: BIN_ID, itemKey: '' }, AUTH);
    expect(result.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown row', async () => {
    mockGet.mockResolvedValue(null);
    expect((await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH)).status).toBe(404);
  });

  it('answers 409 for cancelled, resolved, and expired rows', async () => {
    for (const status of ['cancelled', 'resolved', 'expired']) {
      mockGet.mockResolvedValue(makeBin({ status }));
      expect((await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH)).status).toBe(409);
    }
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('answers 400 for a row without an item store', async () => {
    mockGet.mockResolvedValue(makeBin({ envelope: JSON.stringify({ instructions: 'x' }) }));
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not an accumulator/);
  });

  it('rejects a non-object payload with 400', async () => {
    mockGet.mockResolvedValue(makeBin());
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'x', payload: [] as any }, AUTH);
    expect(result.status).toBe(400);
  });
});

describe('accumulateItem (api) — RBAC', () => {
  it('hides rows outside the caller read scope with 404', async () => {
    mockHasGlobal.mockResolvedValue(false);
    vi.mocked(userService.getRoleScope).mockResolvedValue({ allRoles: [], selfRoles: [] } as any);
    mockGet.mockResolvedValue(makeBin());
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH);
    expect(result.status).toBe(404);
    expect(mockAdd).not.toHaveBeenCalled();
  });
});

describe('accumulateItem (api) — the add', () => {
  it('forwards the actor, provenance, and claim assertion, and maps accepted', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue(accepted(2, 1));
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'bag-2', payload: { w: 2 }, metadata: { lane: 'A' }, assertClaim: true }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ outcome: 'accepted', count: 2, remaining: 1, escalationId: BIN_ID });
    const [id, input] = mockAdd.mock.calls[0];
    expect(id).toBe(BIN_ID);
    expect(input.itemKey).toBe('bag-2');
    expect(input.payload).toEqual({ w: 2 });
    expect(input.metadata).toEqual({ lane: 'A', resolved_by: AUTH.userId });
    expect(input.actor).toBe(AUTH.userId);
    expect(input.assertClaim).toBe(AUTH.userId);
  });

  it('maps completed with the signal flag and workflow id', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue({ outcome: 'completed', count: 3, remaining: 0, escalation: makeBin({ status: 'resolved' }) });
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'bag-3' }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ outcome: 'completed', count: 3, remaining: 0, signaled: true, workflowId: 'wf-1' });
  });

  it('gates the reciprocal by id (404 unknown) and forwards it resolved to its id', async () => {
    mockGet.mockImplementation(async (id: string) => (id === BIN_ID ? makeBin() : null));
    const missing = await accumulateItem({ id: BIN_ID, itemKey: 'o-1', reciprocal: { id: MEMBER_ID } }, AUTH);
    expect(missing.status).toBe(404);
    expect(missing.error).toMatch(/Reciprocal/);
    expect(mockAdd).not.toHaveBeenCalled();

    mockGet.mockImplementation(async (id: string) =>
      id === BIN_ID ? makeBin() : makeBin({ id: MEMBER_ID, role: 'member' }));
    mockAdd.mockResolvedValue({
      ...accepted(2, 1),
      reciprocal: { outcome: 'completed', count: 1, remaining: 0, escalation: makeBin({ id: MEMBER_ID, status: 'resolved', signal_key: 'sig-m' }) },
    });
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'o-1', reciprocal: { id: MEMBER_ID, payload: { slot: 1 } } }, AUTH);
    expect(result.status).toBe(200);
    expect(mockAdd.mock.calls[0][1].reciprocal).toEqual({ id: MEMBER_ID, payload: { slot: 1 } });
    expect(result.data.reciprocal).toMatchObject({ outcome: 'completed', count: 1, escalationId: MEMBER_ID, signaled: true });
  });

  it('gates the reciprocal by signal key and rejects an ambiguous selector', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockGetBySignalKey.mockResolvedValue(makeBin({ id: MEMBER_ID }));
    mockAdd.mockResolvedValue(accepted(2, 1));
    await accumulateItem({ id: BIN_ID, itemKey: 'o-1', reciprocal: { signalKey: 'sig-m' } }, AUTH);
    expect(mockAdd.mock.calls[0][1].reciprocal).toEqual({ id: MEMBER_ID, payload: undefined });

    const both = await accumulateItem({ id: BIN_ID, itemKey: 'o-1', reciprocal: { id: MEMBER_ID, signalKey: 'sig-m' } }, AUTH);
    expect(both.status).toBe(400);
  });

  it.each([
    ['duplicate-item', 409, /already held/],
    ['full', 409, /full/],
    ['claimed-by-other', 409, /claimed/],
    ['claim-expired', 409, /expired/],
    ['not-found', 404, /not found/],
    ['not-accumulator', 400, /not an accumulator/],
    ['already-resolved', 409, /not available/],
    ['reciprocal-not-found', 404, /Reciprocal/],
    ['reciprocal-full', 409, /Reciprocal/],
    ['reciprocal-duplicate', 409, /Reciprocal/],
    ['reciprocal-terminal', 409, /Reciprocal/],
    ['reciprocal-not-accumulator', 400, /Reciprocal/],
  ])('maps outcome %s to %d', async (outcome, status, message) => {
    mockGet.mockResolvedValue(makeBin());
    mockAdd.mockResolvedValue({ outcome, count: -1, remaining: null, escalation: null } as any);
    const result = await accumulateItem({ id: BIN_ID, itemKey: 'x' }, AUTH);
    expect(result.status).toBe(status);
    expect(result.error).toMatch(message);
  });
});

describe('removeItem (api)', () => {
  it('removes with the actor and maps the count', async () => {
    mockGet.mockResolvedValue(makeBin());
    mockRemove.mockResolvedValue({ outcome: 'removed', count: 0, escalation: makeBin() });
    const result = await removeItem({ id: BIN_ID, itemKey: 'bag-1' }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ outcome: 'removed', count: 0, escalationId: BIN_ID });
    expect(mockRemove.mock.calls[0][1]).toMatchObject({ itemKey: 'bag-1', actor: AUTH.userId });
  });

  it.each([
    ['item-absent', 404],
    ['not-found', 404],
    ['not-accumulator', 400],
    ['already-resolved', 409],
    ['reciprocal-absent', 404],
    ['reciprocal-terminal', 409],
  ])('maps outcome %s to %d', async (outcome, status) => {
    mockGet.mockResolvedValue(makeBin());
    mockRemove.mockResolvedValue({ outcome, count: -1, escalation: null } as any);
    expect((await removeItem({ id: BIN_ID, itemKey: 'x' }, AUTH)).status).toBe(status);
  });

  it('answers 409 on a terminal row and 400 on a non-accumulator', async () => {
    mockGet.mockResolvedValue(makeBin({ status: 'expired' }));
    expect((await removeItem({ id: BIN_ID, itemKey: 'x' }, AUTH)).status).toBe(409);
    mockGet.mockResolvedValue(makeBin({ envelope: '{}' }));
    expect((await removeItem({ id: BIN_ID, itemKey: 'x' }, AUTH)).status).toBe(400);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('getEscalationItems (api)', () => {
  it('returns the ordered accumulator items with count and max', async () => {
    mockGet.mockResolvedValue(makeBin({
      envelope: JSON.stringify({
        accumulate_items: {
          'bag-2': { at: '2026-01-01T00:00:02Z', actor: 'u-2', reciprocalId: MEMBER_ID },
          'bag-1': { at: '2026-01-01T00:00:01Z', payload: { w: 1 } },
        },
      }),
      metadata: { accumulate_count: 2, accumulate_max: 3, accumulate_keys: ['bag-2', 'bag-1'] },
    }));
    const result = await getEscalationItems({ id: BIN_ID }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ kind: 'accumulate', count: 2, max: 3, status: 'pending' });
    expect(result.data!.items.map((i) => i.itemKey)).toEqual(['bag-1', 'bag-2']);
    expect(result.data!.items[1]).toMatchObject({ actor: 'u-2', reciprocalId: MEMBER_ID });
  });

  it('normalizes a batch row and reports pending keys', async () => {
    mockGet.mockResolvedValue(makeBin({
      metadata: { batch_pending: ['paint'], batch_count: 1, batch_keys: ['cut', 'weld', 'paint'] },
      envelope: JSON.stringify({
        batch_items: { weld: { ok: true }, cut: { ok: true } },
        batch_filled_at: { cut: '2026-01-01T00:00:01Z', weld: '2026-01-01T00:00:02Z' },
      }),
    }));
    const result = await getEscalationItems({ id: BIN_ID }, AUTH);
    expect(result.data).toMatchObject({ kind: 'batch', count: 2, max: 3, pending: ['paint'] });
    expect(result.data!.items.map((i) => i.itemKey)).toEqual(['cut', 'weld']);
  });

  it('answers 400 for a row without items and 404 for an unknown row', async () => {
    mockGet.mockResolvedValue(makeBin({ envelope: '{}', metadata: {} }));
    expect((await getEscalationItems({ id: BIN_ID }, AUTH)).status).toBe(400);
    mockGet.mockResolvedValue(null);
    expect((await getEscalationItems({ id: BIN_ID }, AUTH)).status).toBe(404);
  });
});
