import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../services/escalation');
vi.mock('../../services/user');
vi.mock('../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { findByMetadata, claimByMetadata, resolveByMetadata } from '../../api/escalations/metadata';

const mockFindByMetadata = vi.mocked(escalationService.findByMetadata);
const mockClaimByMetadata = vi.mocked(escalationService.claimByMetadata);
const mockResolveByMetadataAtomic = vi.mocked(escalationService.resolveByMetadataAtomic);
const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserByExternalId = vi.mocked(userService.getUserByExternalId);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);

const SYSTEM_AUTH = { userId: 'system-uuid' };

function makeEscalation(overrides: Record<string, any> = {}) {
  return {
    id: 'esc-uuid',
    type: 'order',
    subtype: 'station',
    status: 'pending',
    role: 'operator',
    assigned_to: null,
    assigned_until: null,
    workflow_id: 'wf-123',
    workflow_type: 'orderPipeline',
    task_queue: 'order-pipeline',
    metadata: { orderId: 'order-123' },
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobalAccess.mockResolvedValue(true);
  mockGetUserRoles.mockResolvedValue([]);
});

// ── findByMetadata ──────────────────────────────────────────────────────

describe('findByMetadata', () => {
  it('returns matching escalations', async () => {
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });

    const result = await findByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.escalations).toHaveLength(1);
    expect(result.data.total).toBe(1);
  });

  it('passes status filter', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [], total: 0 });

    await findByMetadata({ key: 'orderId', value: 'order-123', status: 'pending' }, SYSTEM_AUTH);

    expect(mockFindByMetadata).toHaveBeenCalledWith('orderId', 'order-123', 'pending', undefined, undefined);
  });

  it('returns 400 when key or value missing', async () => {
    const result = await findByMetadata({ key: '', value: 'order-123' }, SYSTEM_AUTH);
    expect(result.status).toBe(400);
  });

  it('scopes results by visible roles for non-global user', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([{ role: 'reviewer', type: 'member', created_at: new Date() } as any]);
    const esc = makeEscalation({ role: 'operator' });
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });

    const result = await findByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.escalations).toHaveLength(0);
  });
});

// ── claimByMetadata ─────────────────────────────────────────────────────

describe('claimByMetadata', () => {
  it('claims an escalation by metadata (global access)', async () => {
    const esc = makeEscalation();
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.escalation.id).toBe('esc-uuid');
    // Global access passes null as allowedRoles
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined, undefined, null,
    );
  });

  it('resolves assignee from external_id', async () => {
    const esc = makeEscalation();
    mockGetUserByExternalId.mockResolvedValue({ id: 'resolved-uuid' } as any);
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    await claimByMetadata({ key: 'orderId', value: 'order-123', assignee: 'ext-42' }, SYSTEM_AUTH);

    expect(mockGetUserByExternalId).toHaveBeenCalledWith('ext-42');
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'resolved-uuid', undefined, undefined, null,
    );
  });

  it('returns 404 when assignee external_id not found (no provision flag)', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123', assignee: 'nonexistent' }, SYSTEM_AUTH);

    expect(result.status).toBe(404);
    expect(result.error).toContain('User not found');
  });

  it('returns 404 when no pending escalation matches', async () => {
    mockClaimByMetadata.mockResolvedValue(null);

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(404);
  });

  it('returns 400 when key or value missing', async () => {
    const result = await claimByMetadata({ key: 'orderId', value: '' }, SYSTEM_AUTH);
    expect(result.status).toBe(400);
  });

  it('passes scoped roles for non-global user', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([{ role: 'operator', type: 'member' } as any]);
    const esc = makeEscalation();
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    // Non-global user passes their roles as allowedRoles
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined, undefined, ['operator'],
    );
  });

  it('passes empty roles for user with no role assignments', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([]);
    const esc = makeEscalation();
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    // Empty roles → empty array (SQL WHERE filters out all rows)
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined, undefined, [],
    );
  });

  it('passes metadata to service for atomic merge', async () => {
    const esc = makeEscalation();
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    await claimByMetadata({
      key: 'orderId', value: 'order-123',
      metadata: { claimedBy: 'jimbo', station: 'scanning' },
    }, SYSTEM_AUTH);

    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined,
      { claimedBy: 'jimbo', station: 'scanning' }, null,
    );
  });
});

// ── resolveByMetadata ───────────────────────────────────────────────────

describe('resolveByMetadata', () => {
  it('atomically resolves non-signal escalation', async () => {
    const esc = makeEscalation({ status: 'resolved' });
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'resolved',
      escalation: esc as any,
    });

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.escalation.id).toBe('esc-uuid');
  });

  it('returns signal info for signal-backed escalation', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'signal_required',
      signalId: 'sig-123',
      escalationId: 'esc-uuid',
      workflowId: 'wf-123',
      workflowType: 'orderPipeline',
      taskQueue: 'order-pipeline',
    });

    // Mock the workflow client
    const mockSignal = vi.fn();
    vi.doMock('../../workers', () => ({
      createClient: () => ({
        workflow: {
          getHandle: vi.fn().mockResolvedValue({ signal: mockSignal }),
        },
      }),
    }));

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.signaled).toBe(true);
    expect(result.data.escalationId).toBe('esc-uuid');
  });

  it('returns 404 when no pending escalation found', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue({ outcome: 'not_found' });

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(404);
  });

  it('returns 400 when resolverPayload missing', async () => {
    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: undefined as any,
    }, SYSTEM_AUTH);

    expect(result.status).toBe(400);
  });

  it('passes metadata for atomic merge in CTE', async () => {
    const esc = makeEscalation({ status: 'resolved' });
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'resolved',
      escalation: esc as any,
    });

    await resolveByMetadata({
      key: 'orderId', value: 'order-123',
      resolverPayload: { approved: true },
      metadata: { completedBy: 'jimbo' },
    }, SYSTEM_AUTH);

    expect(mockResolveByMetadataAtomic).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid',
      { approved: true }, { completedBy: 'jimbo' }, null,
    );
  });
});
