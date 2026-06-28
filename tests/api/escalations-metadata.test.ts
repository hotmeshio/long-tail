import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies. Keep the pure scope helpers (effectiveScope etc.) real;
// only stub the DB-touching user functions the scope partition + assignee
// resolution depend on.
vi.mock('../../services/escalation');
vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return {
    ...actual,
    hasGlobalEscalationAccess: vi.fn(),
    getUserRoles: vi.fn(),
    getUserByExternalId: vi.fn(),
    createUser: vi.fn(),
  };
});
vi.mock('../../lib/events/publish', () => ({
  publishEscalationEvent: vi.fn(),
}));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { findByMetadata, claimByMetadata, resolveByMetadata } from '../../api/escalations/metadata';

const mockFindByMetadata = vi.mocked(escalationService.findByMetadata);
const mockClaimByMetadata = vi.mocked(escalationService.claimByMetadata);
const mockResolveByMetadataAtomic = vi.mocked(escalationService.resolveByMetadataAtomic);
const mockResolveEscalation = vi.mocked(escalationService.resolveEscalation);
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

    // Global caller (beforeEach) → no role filter (6th arg undefined).
    expect(mockFindByMetadata).toHaveBeenCalledWith('orderId', 'order-123', 'pending', undefined, undefined, undefined);
  });

  it('returns 400 when key or value missing', async () => {
    const result = await findByMetadata({ key: '', value: 'order-123' }, SYSTEM_AUTH);
    expect(result.status).toBe(400);
  });

  it('scopes by read access IN SQL for a non-global user (no client-side filter)', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'reviewer', type: 'member', read_scope: 'all', write_scope: 'all', created_at: new Date() } as any,
    ]);
    // The service already applied the role-scope filter in SQL; the controller
    // returns its result as-is.
    const esc = makeEscalation({ role: 'reviewer' });
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });

    const result = await findByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    // The caller's read scope flows INTO the query as the 6th arg — the SQL does the
    // filtering AND the count, so `total` stays correct across pages. The controller
    // never filters a fetched page client-side.
    expect(mockFindByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', undefined, undefined, undefined,
      { allRoles: ['reviewer'], selfRoles: [], meUserId: 'system-uuid' },
    );
    // Returned unchanged — no client-side filter shrinking the page or total.
    expect(result.data.total).toBe(1);
    expect(result.data.escalations).toHaveLength(1);
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

  it('passes scoped write_all roles for non-global user', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'operator', type: 'member', read_scope: 'all', write_scope: 'all', created_at: new Date() } as any,
    ]);
    const esc = makeEscalation();
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    // Non-global user passes their write_all roles as allowedRoles (write_self
    // roles are excluded — the SDK claim-by-metadata cannot enforce ownership).
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined, undefined, ['operator'],
    );
  });

  it('excludes write_self roles from claim-by-metadata for non-global user', async () => {
    mockHasGlobalAccess.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([
      { role: 'customer-triage', type: 'member', read_scope: 'self', write_scope: 'self', created_at: new Date() } as any,
    ]);
    const esc = makeEscalation();
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false, candidatesExist: 1 });

    await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    // Only write_self roles → empty write_all set → SQL matches nothing.
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined, undefined, [],
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

  it('calls SDK resolve for atomic conditionLT escalation (signal_key set)', async () => {
    const esc = makeEscalation({ status: 'resolved' });
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'signal_required',
      signalKey: 'station-done-wf-123',
      escalationId: 'esc-uuid',
      workflowId: 'wf-123',
      workflowType: 'stationWorker',
      taskQueue: 'order-pipeline',
    });
    mockResolveEscalation.mockResolvedValue(esc as any);

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.signaled).toBe(true);
    expect(result.data.escalationId).toBe('esc-uuid');
    // SDK resolve is called — not handle.signal
    expect(mockResolveEscalation).toHaveBeenCalledWith('esc-uuid', { approved: true });
  });

  it('returns 409 when concurrent caller already claimed a signal_id escalation', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'conflict',
      escalationId: 'esc-uuid',
    });

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(409);
    expect(mockResolveEscalation).not.toHaveBeenCalled();
  });

  it('returns 409 when SDK resolve returns null for signal_key escalation', async () => {
    mockResolveByMetadataAtomic.mockResolvedValue({
      outcome: 'signal_required',
      signalKey: 'station-done-wf-123',
      escalationId: 'esc-uuid',
      workflowId: 'wf-123',
      workflowType: 'stationWorker',
      taskQueue: 'order-pipeline',
    });
    mockResolveEscalation.mockResolvedValue(null);

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(409);
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

    // Global caller → both write-scope filters null (no role filter).
    expect(mockResolveByMetadataAtomic).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid',
      { approved: true }, { completedBy: 'jimbo' }, null, null,
    );
  });
});
