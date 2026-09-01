import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocked decision-tree coverage for the by-id batch surface. Schema
// enforcement is exercised end-to-end in resolve-batch-item-enforcement.test.ts;
// here the enforcing set is empty so the gate is a zero-read no-op.
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: vi.fn(async () => new Set<string>()),
  getEnforcedFormSchema: vi.fn(async () => null),
}));

vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({
  escalationStrategyRegistry: { current: null },
}));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(async () => 'eph-uuid-1'),
  formatEphemeralToken: (uuid: string, label: string) => `eph:v1:${label}:${uuid}`,
}));
vi.mock('../../workers', () => ({
  createClient: () => ({
    workflow: { getHandle: vi.fn(), start: vi.fn() },
  }),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveBatchItem } from '../../api/escalations/resolve-batch';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockBatchItem = vi.mocked(escalationService.resolveBatchItem);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetRoleScope = vi.mocked(userService.getRoleScope);

const AUTH = { userId: 'user-uuid' };

function makeBatchEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-batch',
    status: 'pending',
    role: 'assembly',
    signal_key: 'sig-batch-1',
    assigned_to: null,
    assigned_until: null,
    workflow_id: 'wf-1',
    workflow_type: 'batchSignal',
    task_queue: 'long-tail-examples',
    metadata: { batch_pending: ['cut', 'weld'], batch_count: 2, batch_keys: ['cut', 'weld'] },
    envelope: JSON.stringify({ batch_items: {} }),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const accepted = (remaining: number): any => ({
  outcome: 'accepted',
  remaining,
  escalation: makeBatchEscalation({ metadata: { batch_count: remaining } }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
});

describe('resolveBatchItem (api) — input and shape gates', () => {
  it('rejects a missing itemKey with 400', async () => {
    const result = await resolveBatchItem({ id: 'e', itemKey: '', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(400);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('rejects a missing resolverPayload with 400', async () => {
    const result = await resolveBatchItem({ id: 'e', itemKey: 'cut', resolverPayload: undefined as any }, AUTH);
    expect(result.status).toBe(400);
  });

  it('returns 404 when the escalation does not exist', async () => {
    mockGet.mockResolvedValue(null);
    const result = await resolveBatchItem({ id: 'nope', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(404);
    expect(mockBatchItem).not.toHaveBeenCalled();
  });

  it('returns 409 for terminal rows', async () => {
    mockGet.mockResolvedValue(makeBatchEscalation({ status: 'resolved' }));
    const result = await resolveBatchItem({ id: 'e', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
  });

  it('returns 400 when the row carries no batch declaration', async () => {
    mockGet.mockResolvedValue(makeBatchEscalation({ metadata: { orderId: 'x' } }));
    const result = await resolveBatchItem({ id: 'e', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not a batch/);
    expect(mockBatchItem).not.toHaveBeenCalled();
  });
});

describe('resolveBatchItem (api) — RBAC', () => {
  it('returns 404 (non-disclosure) when the caller cannot see the role', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockGetRoleScope.mockResolvedValue(null as any);
    mockGet.mockResolvedValue(makeBatchEscalation());
    const result = await resolveBatchItem({ id: 'e', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(404);
    expect(mockBatchItem).not.toHaveBeenCalled();
  });

  it('returns 403 when visible but not writable', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockGetRoleScope.mockResolvedValue({ read: 'all', write: 'none' } as any);
    mockGet.mockResolvedValue(makeBatchEscalation());
    const result = await resolveBatchItem({ id: 'e', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(403);
  });
});

describe('resolveBatchItem (api) — outcome mapping', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(makeBatchEscalation());
  });

  it('maps an interim fill to 200 accepted with remaining', async () => {
    mockBatchItem.mockResolvedValue(accepted(1));
    const result = await resolveBatchItem({ id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(200);
    expect((result.data as any).outcome).toBe('accepted');
    expect((result.data as any).remaining).toBe(1);
  });

  it('maps the completing fill to 200 completed with signaled', async () => {
    mockBatchItem.mockResolvedValue({
      outcome: 'completed',
      remaining: 0,
      escalation: makeBatchEscalation({ status: 'resolved' }),
    } as any);
    const result = await resolveBatchItem({ id: 'esc-batch', itemKey: 'weld', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(200);
    expect((result.data as any).outcome).toBe('completed');
    expect((result.data as any).remaining).toBe(0);
    expect((result.data as any).signaled).toBe(true);
    expect((result.data as any).workflowId).toBe('wf-1');
  });

  it('maps duplicate-item to 409 with the itemKey named', async () => {
    mockBatchItem.mockResolvedValue({ outcome: 'duplicate-item', remaining: -1, escalation: null });
    const result = await resolveBatchItem({ id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
    expect((result.data as any).itemKey).toBe('cut');
  });

  it('maps unknown-item to 400 (caller bug — fail loud)', async () => {
    mockBatchItem.mockResolvedValue({ outcome: 'unknown-item', remaining: -1, escalation: null });
    const result = await resolveBatchItem({ id: 'esc-batch', itemKey: 'polish', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(400);
  });

  it('maps claim conflicts to 409', async () => {
    mockBatchItem.mockResolvedValue({ outcome: 'claimed-by-other', remaining: -1, escalation: null });
    const result = await resolveBatchItem({ id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/claimed by another/);
  });

  it('maps already-* races to 409', async () => {
    mockBatchItem.mockResolvedValue({ outcome: 'already-expired', remaining: -1, escalation: null });
    const result = await resolveBatchItem({ id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(result.status).toBe(409);
  });
});

describe('resolveBatchItem (api) — claim semantics and provenance', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(makeBatchEscalation());
    mockBatchItem.mockResolvedValue(accepted(1));
  });

  it('is claim-agnostic by default — no assertClaim forwarded', async () => {
    await resolveBatchItem({ id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH);
    expect(mockBatchItem).toHaveBeenCalledWith(
      'esc-batch', 'cut', { ok: true }, { resolved_by: 'user-uuid' }, undefined, { id: 'user-uuid' },
    );
  });

  it('assertClaim: true forwards the caller into the guarded statement', async () => {
    await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true }, assertClaim: true }, AUTH,
    );
    expect(mockBatchItem).toHaveBeenCalledWith(
      'esc-batch', 'cut', { ok: true }, { resolved_by: 'user-uuid' }, 'user-uuid', { id: 'user-uuid' },
    );
  });

  it('the caller metadata patch rides the same atomic fill with provenance merged', async () => {
    await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: { ok: true }, metadata: { station: 'st-1' } }, AUTH,
    );
    expect(mockBatchItem).toHaveBeenCalledWith(
      'esc-batch', 'cut', { ok: true },
      { station: 'st-1', resolved_by: 'user-uuid' }, undefined, { id: 'user-uuid' },
    );
  });
});
