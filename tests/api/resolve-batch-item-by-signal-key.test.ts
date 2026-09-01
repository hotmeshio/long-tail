import { describe, it, expect, vi, beforeEach } from 'vitest';

// By-signal-key batch fill: the webhook/call-home surface. Mirrors
// resolve-by-signal-key semantics — claim-agnostic, write-scope gated with
// 404 non-disclosure. Enforcement runs the same gate as the by-id surface.
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
  createClient: () => ({ workflow: { getHandle: vi.fn(), start: vi.fn() } }),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveBatchItemBySignalKey } from '../../api/escalations/resolve-batch';

const mockGetBySignalKey = vi.mocked(escalationService.getEscalationBySignalKey);
const mockBatchBySignalKey = vi.mocked(escalationService.resolveBatchItemBySignalKey);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetRoleScope = vi.mocked(userService.getRoleScope);

const AUTH = { userId: 'user-uuid' };
const SIGNAL_KEY = 'fanout-home-wf-1';

function makeBatchEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-batch',
    status: 'pending',
    role: 'assembly',
    signal_key: SIGNAL_KEY,
    assigned_to: null,
    assigned_until: null,
    workflow_id: 'wf-1',
    workflow_type: 'batchFanout',
    task_queue: 'long-tail-examples',
    metadata: { batch_pending: ['cut', 'weld'], batch_count: 2, batch_keys: ['cut', 'weld'] },
    envelope: JSON.stringify({ batch_items: {} }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
});

describe('resolveBatchItemBySignalKey (api)', () => {
  it('rejects a missing signalKey with 400', async () => {
    const result = await resolveBatchItemBySignalKey(
      { signalKey: '', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(400);
    expect(mockGetBySignalKey).not.toHaveBeenCalled();
  });

  it('rejects a missing itemKey with 400', async () => {
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: '', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(400);
  });

  it('returns 404 when the signal_key is unknown', async () => {
    mockGetBySignalKey.mockResolvedValue(null);
    const result = await resolveBatchItemBySignalKey(
      { signalKey: 'unknown', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(404);
    expect(mockBatchBySignalKey).not.toHaveBeenCalled();
  });

  it('returns 409 for terminal rows', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBatchEscalation({ status: 'resolved' }));
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(409);
  });

  it('returns 400 when the row carries no batch declaration', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBatchEscalation({ metadata: { orderId: 'x' } }));
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not a batch/);
  });

  it('returns 404 (non-disclosure) when write scope denies', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockGetRoleScope.mockResolvedValue({ read: 'all', write: 'none' } as any);
    mockGetBySignalKey.mockResolvedValue(makeBatchEscalation());
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(404);
    expect(mockBatchBySignalKey).not.toHaveBeenCalled();
  });

  it('fills claim-agnostically with provenance, delegating by signal key', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBatchEscalation());
    mockBatchBySignalKey.mockResolvedValue({
      outcome: 'accepted', remaining: 1, escalation: makeBatchEscalation(),
    } as any);
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: 'cut', resolverPayload: { ok: true }, metadata: { unit: 'u1-L' } },
      AUTH,
    );
    expect(result.status).toBe(200);
    expect((result.data as any).outcome).toBe('accepted');
    expect((result.data as any).remaining).toBe(1);
    expect(mockBatchBySignalKey).toHaveBeenCalledWith(
      SIGNAL_KEY, 'cut', { ok: true },
      { unit: 'u1-L', resolved_by: 'user-uuid' }, { id: 'user-uuid' },
    );
  });

  it('maps the completing fill to 200 completed with signaled', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBatchEscalation());
    mockBatchBySignalKey.mockResolvedValue({
      outcome: 'completed', remaining: 0, escalation: makeBatchEscalation({ status: 'resolved' }),
    } as any);
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: 'weld', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(200);
    expect((result.data as any).outcome).toBe('completed');
    expect((result.data as any).signaled).toBe(true);
    expect((result.data as any).workflowId).toBe('wf-1');
  });

  it('maps duplicate-item to 409 with the itemKey named (idempotent retries)', async () => {
    mockGetBySignalKey.mockResolvedValue(makeBatchEscalation());
    mockBatchBySignalKey.mockResolvedValue({ outcome: 'duplicate-item', remaining: -1, escalation: null });
    const result = await resolveBatchItemBySignalKey(
      { signalKey: SIGNAL_KEY, itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(409);
    expect((result.data as any).itemKey).toBe('cut');
  });
});
