import { describe, it, expect, vi, beforeEach } from 'vitest';

// Faceted batch surface: single-call when no role enforces; two-phase
// (select → validate → fill by asserted id) when enforcing roles exist.
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

const mockGetEnforcingRoles = vi.fn();
const mockGetEnforcedFormSchema = vi.fn();
vi.mock('../../services/role/enforcement-cache', () => ({
  getEnforcingRoles: (...a: any[]) => mockGetEnforcingRoles(...a),
  getEnforcedFormSchema: (...a: any[]) => mockGetEnforcedFormSchema(...a),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveBatchItemByMetadata } from '../../api/escalations/resolve-batch';
import { LT_ERROR_CODES } from '../../types/validation';

const mockBatchByMeta = vi.mocked(escalationService.resolveBatchItemByMetadata);
const mockBatchItem = vi.mocked(escalationService.resolveBatchItem);
const mockFindByMetadata = vi.mocked(escalationService.findByMetadata);
const mockHasGlobal = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);
const mockEffectiveScope = vi.mocked(userService.effectiveScope);

const AUTH = { userId: 'user-uuid' };
const SCHEMA = {
  required: ['status'],
  properties: { status: { type: 'string', enum: ['done', 'blocked'] } },
};

function makeBatchRow(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-batch',
    status: 'pending',
    role: 'station-a',
    signal_key: 'sig-1',
    workflow_id: 'wf-1',
    assigned_to: null,
    metadata: { orderId: 'ORD-1', batch_pending: ['cut', 'weld'], batch_count: 2, batch_keys: ['cut', 'weld'] },
    envelope: JSON.stringify({ batch_items: {} }),
    ...overrides,
  };
}

const acceptedOutcome = { outcome: 'accepted', remaining: 1, escalation: makeBatchRow() } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobal.mockResolvedValue(true);
  mockGetUserRoles.mockResolvedValue([]);
  mockGetEnforcingRoles.mockResolvedValue(new Set<string>());
});

describe('resolveBatchItemByMetadata (api) — input gates', () => {
  it('rejects missing key/value with 400', async () => {
    const result = await resolveBatchItemByMetadata(
      { key: '', value: '', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(400);
  });

  it('rejects a missing itemKey with 400', async () => {
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: '', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(400);
  });
});

describe('resolveBatchItemByMetadata (api) — single-call path (no enforcing roles)', () => {
  it('delegates one atomic by-metadata call for a global caller (no role filter)', async () => {
    mockBatchByMeta.mockResolvedValue(acceptedOutcome);
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(200);
    expect((result.data as any).outcome).toBe('accepted');
    expect(mockBatchByMeta).toHaveBeenCalledWith(
      'orderId', 'ORD-1', 'cut', { ok: true }, undefined,
      { resolved_by: 'user-uuid' }, { id: 'user-uuid' },
    );
    expect(mockFindByMetadata).not.toHaveBeenCalled();
  });

  it('folds the caller write scope into the role filter', async () => {
    mockHasGlobal.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'station-a', type: 'member', read_scope: 'all', write_scope: 'all' },
    ] as any);
    mockEffectiveScope.mockImplementation(
      (_type: any, read: any, write: any) => ({ read, write }) as any,
    );
    mockBatchByMeta.mockResolvedValue(acceptedOutcome);
    await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(mockBatchByMeta).toHaveBeenCalledWith(
      'orderId', 'ORD-1', 'cut', { ok: true }, ['station-a'],
      { resolved_by: 'user-uuid' }, { id: 'user-uuid' },
    );
  });

  it('maps not-found to 404', async () => {
    mockBatchByMeta.mockResolvedValue({ outcome: 'not-found', remaining: -1, escalation: null });
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'nope', itemKey: 'cut', resolverPayload: { ok: true } }, AUTH,
    );
    expect(result.status).toBe(404);
  });
});

describe('resolveBatchItemByMetadata (api) — two-phase enforcement', () => {
  beforeEach(() => {
    mockGetEnforcingRoles.mockResolvedValue(new Set(['station-a']));
    mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
  });

  it('selects the row, validates against ITS schema, then fills by asserted id', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [makeBatchRow()], total: 1 });
    mockBatchItem.mockResolvedValue(acceptedOutcome);
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: 'cut', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(200);
    // phase 2 targets the asserted row id — never a second facet selection
    expect(mockBatchItem).toHaveBeenCalledWith(
      'esc-batch', 'cut', { status: 'done' },
      { resolved_by: 'user-uuid' }, undefined, { id: 'user-uuid' },
    );
    expect(mockBatchByMeta).not.toHaveBeenCalled();
  });

  it('rejects a violating item with the canonical 422 and writes nothing', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [makeBatchRow()], total: 1 });
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: 'cut', resolverPayload: { status: 'later' } }, AUTH,
    );
    expect(result.status).toBe(422);
    expect(result.code).toBe(LT_ERROR_CODES.SCHEMA_VALIDATION);
    expect(mockBatchItem).not.toHaveBeenCalled();
    expect(mockBatchByMeta).not.toHaveBeenCalled();
  });

  it('returns 404 when no scoped row matches', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [], total: 0 });
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: 'cut', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(404);
  });

  it('maps a row that went terminal between phases to 409 (concurrent resolution)', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [makeBatchRow()], total: 1 });
    mockBatchItem.mockResolvedValue({ outcome: 'not-found', remaining: -1, escalation: null });
    const result = await resolveBatchItemByMetadata(
      { key: 'orderId', value: 'ORD-1', itemKey: 'cut', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(409);
    expect(result.error).toMatch(/concurrent/);
  });
});
