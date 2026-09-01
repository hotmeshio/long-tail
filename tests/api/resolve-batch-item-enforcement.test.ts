import { describe, it, expect, vi, beforeEach } from 'vitest';

// Enforcement gate END-TO-END for batch item submissions: real
// resolver-validation and shared validation run; only the role cache and
// DB-touching services are stubbed. Every batch item validates against the
// SAME versioned schema a single-item resolve uses.
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
import { resolveBatchItem } from '../../api/escalations/resolve-batch';
import { LT_ERROR_CODES } from '../../types/validation';

const mockGet = vi.mocked(escalationService.getEscalation);
const mockBatchItem = vi.mocked(escalationService.resolveBatchItem);

const AUTH = { userId: 'user-uuid' };
const SCHEMA = {
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['done', 'blocked'] },
    secret: { type: 'string', format: 'password' },
  },
};

function makeBatchEscalation(overrides: Record<string, any> = {}): any {
  return {
    id: 'esc-batch',
    status: 'pending',
    role: 'station-a',
    signal_key: 'sig-1',
    assigned_to: null,
    workflow_id: 'wf-1',
    workflow_type: null,
    task_queue: null,
    metadata: { batch_pending: ['cut', 'weld'], batch_count: 2, batch_keys: ['cut', 'weld'] },
    envelope: JSON.stringify({ batch_items: {} }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(userService.hasGlobalEscalationAccess).mockResolvedValue(true);
  mockGetEnforcingRoles.mockResolvedValue(new Set(['station-a']));
  mockGetEnforcedFormSchema.mockResolvedValue(SCHEMA);
});

describe('resolve-batch-item enforcement', () => {
  it('rejects a violating item with the canonical 422 before any fill', async () => {
    mockGet.mockResolvedValue(makeBatchEscalation());
    const result = await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: { status: 'later' } }, AUTH,
    );
    expect(result.status).toBe(422);
    expect(result.code).toBe(LT_ERROR_CODES.SCHEMA_VALIDATION);
    expect((result.data as any).violations).toEqual([
      { field: 'status', message: 'Must be one of: done, blocked' },
    ]);
    expect((result.data as any).role).toBe('station-a');
    expect(mockBatchItem).not.toHaveBeenCalled();
  });

  it('accepts a conforming item and fills it', async () => {
    mockGet.mockResolvedValue(makeBatchEscalation());
    mockBatchItem.mockResolvedValue({
      outcome: 'accepted', remaining: 1, escalation: makeBatchEscalation(),
    } as any);
    const result = await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(200);
  });

  it('validates against the pinned schema_version snapshot when present', async () => {
    mockGet.mockResolvedValue(makeBatchEscalation({
      metadata: {
        batch_pending: ['cut'], batch_count: 1, batch_keys: ['cut'], schema_version: 3,
      },
    }));
    mockBatchItem.mockResolvedValue({
      outcome: 'completed', remaining: 0, escalation: makeBatchEscalation({ status: 'resolved' }),
    } as any);
    const result = await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: { status: 'done' } }, AUTH,
    );
    expect(result.status).toBe(200);
    // The pin travels to the schema resolver — the exact snapshot single-resolve uses.
    expect(mockGetEnforcedFormSchema).toHaveBeenCalledWith('station-a', 3);
  });

  it('leaves non-enforcing roles untouched — zero schema reads', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    mockGet.mockResolvedValue(makeBatchEscalation());
    mockBatchItem.mockResolvedValue({
      outcome: 'accepted', remaining: 1, escalation: makeBatchEscalation(),
    } as any);
    const result = await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: {} }, AUTH,
    );
    expect(result.status).toBe(200);
    expect(mockGetEnforcedFormSchema).not.toHaveBeenCalled();
  });

  it('redacts password fields via the row form_schema before the fill', async () => {
    mockGetEnforcingRoles.mockResolvedValue(new Set());
    mockGet.mockResolvedValue(makeBatchEscalation({
      metadata: {
        batch_pending: ['cut'], batch_count: 1, batch_keys: ['cut'],
        form_schema: SCHEMA,
      },
    }));
    mockBatchItem.mockResolvedValue({
      outcome: 'accepted', remaining: 0, escalation: makeBatchEscalation(),
    } as any);
    await resolveBatchItem(
      { id: 'esc-batch', itemKey: 'cut', resolverPayload: { status: 'done', secret: 'hunter2' } }, AUTH,
    );
    const submitted = mockBatchItem.mock.calls[0][2];
    expect(submitted.secret).toBe('eph:v1:secret:eph-uuid-1');
    expect(submitted.status).toBe('done');
  });
});
