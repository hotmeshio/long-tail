import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { tryResolveByMetadata } from '../../api/escalations/metadata';
import type { EscalationSignalResult } from '../../types/escalation';

const mockResolveByMetadataAtomic = vi.mocked(escalationService.resolveByMetadataAtomic);
const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);

const SYSTEM_AUTH = { userId: 'system-uuid' };

const SIGNAL_REQUIRED_RESULT = {
  outcome: 'signal_required' as const,
  signalId: 'sig-123',
  escalationId: 'esc-uuid',
  workflowId: 'wf-123',
  workflowType: 'orderPipeline',
  taskQueue: 'order-pipeline',
};

function makeEscalation(overrides: Record<string, any> = {}) {
  return {
    id: 'esc-uuid', type: 'order', subtype: 'station',
    status: 'resolved', role: 'operator',
    assigned_to: null, assigned_until: null,
    workflow_id: 'wf-123', workflow_type: 'orderPipeline', task_queue: 'order-pipeline',
    metadata: { orderId: 'order-123' },
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobalAccess.mockResolvedValue(true);
  mockGetUserRoles.mockResolvedValue([]);
});

describe('tryResolveByMetadata', () => {
  it('returns not-found when no pending escalation exists', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue({ outcome: 'not_found' });

    const result = await tryResolveByMetadata(
      { key: 'orderId', value: 'order-123', resolverPayload: { rejected: true } },
      SYSTEM_AUTH,
    );

    expect(result).toEqual<EscalationSignalResult>({ matched: false, reason: 'not-found' });
  });

  it('returns matched when atomically resolved (no signal path)', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'resolved',
      escalation: makeEscalation() as any,
    });

    const result = await tryResolveByMetadata(
      { key: 'orderId', value: 'order-123', resolverPayload: { rejected: true } },
      SYSTEM_AUTH,
    );

    expect(result).toEqual<EscalationSignalResult>({ matched: true });
  });

  it('returns matched when signal_required and signal delivery succeeds', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue(SIGNAL_REQUIRED_RESULT);

    const mockSignal = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../workers', () => ({
      createClient: () => ({
        workflow: { getHandle: vi.fn().mockResolvedValue({ signal: mockSignal }) },
      }),
    }));

    const result = await tryResolveByMetadata(
      { key: 'orderId', value: 'order-123', resolverPayload: { rejected: true } },
      SYSTEM_AUTH,
    );

    expect(result).toEqual<EscalationSignalResult>({ matched: true });
  });

  it('returns resolve-failed when signal_required but signal delivery throws', async () => {
    // This is the critical case: escalation exists in DB but the workflow signal fails.
    // Callers MUST NOT fall through to legacy — the escalation is real and pending.
    mockResolveByMetadataAtomic.mockResolvedValue(SIGNAL_REQUIRED_RESULT);

    vi.doMock('../../workers', () => ({
      createClient: () => ({
        workflow: {
          getHandle: vi.fn().mockResolvedValue({
            signal: vi.fn().mockRejectedValue(new Error('workflow not found')),
          }),
        },
      }),
    }));

    const result = await tryResolveByMetadata(
      { key: 'orderId', value: 'order-123', resolverPayload: { rejected: true } },
      SYSTEM_AUTH,
    );

    expect(result).toEqual<EscalationSignalResult>({ matched: false, reason: 'resolve-failed' });
    expect(result).not.toEqual({ matched: false, reason: 'not-found' });
  });

  it('returns resolve-failed when resolveByMetadataAtomic throws', async () => {
    mockResolveByMetadataAtomic.mockRejectedValue(new Error('DB connection lost'));

    const result = await tryResolveByMetadata(
      { key: 'orderId', value: 'order-123', resolverPayload: { rejected: true } },
      SYSTEM_AUTH,
    );

    expect(result).toEqual<EscalationSignalResult>({ matched: false, reason: 'resolve-failed' });
  });
});
