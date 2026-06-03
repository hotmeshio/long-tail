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
const mockClaimEscalation = vi.mocked(escalationService.claimEscalation);
const mockUpdateMetadata = vi.mocked(escalationService.updateEscalationMetadata);
const mockIsSuperAdmin = vi.mocked(userService.isSuperAdmin);
const mockHasRole = vi.mocked(userService.hasRole);
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
  mockIsSuperAdmin.mockResolvedValue(true);
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
    expect(mockFindByMetadata).toHaveBeenCalledWith('orderId', 'order-123', undefined, undefined, undefined);
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

  it('scopes results by visible roles for non-superadmin', async () => {
    mockIsSuperAdmin.mockResolvedValue(false);
    mockGetUserRoles.mockResolvedValue([{ role: 'reviewer', type: 'member', created_at: new Date() }]);
    const esc = makeEscalation({ role: 'operator' });
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });

    const result = await findByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.escalations).toHaveLength(0);
  });
});

// ── claimByMetadata ─────────────────────────────────────────────────────

describe('claimByMetadata', () => {
  it('claims an escalation by metadata', async () => {
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false });

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(result.data.escalation.id).toBe('esc-uuid');
    expect(result.data.isExtension).toBe(false);
  });

  it('resolves assignee from external_id', async () => {
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockGetUserByExternalId.mockResolvedValue({ id: 'resolved-uuid' } as any);
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false });

    await claimByMetadata({ key: 'orderId', value: 'order-123', assignee: 'ext-42' }, SYSTEM_AUTH);

    expect(mockGetUserByExternalId).toHaveBeenCalledWith('ext-42');
    expect(mockClaimByMetadata).toHaveBeenCalledWith('orderId', 'order-123', 'resolved-uuid', undefined, undefined);
  });

  it('returns 404 when assignee external_id not found', async () => {
    mockGetUserByExternalId.mockResolvedValue(null);

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123', assignee: 'nonexistent' }, SYSTEM_AUTH);

    expect(result.status).toBe(404);
    expect(result.error).toContain('User not found');
  });

  it('returns 404 when no pending escalation found', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [], total: 0 });

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(404);
  });

  it('returns 403 when non-superadmin lacks role', async () => {
    mockIsSuperAdmin.mockResolvedValue(false);
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockHasRole.mockResolvedValue(false);

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(403);
  });

  it('returns 409 when escalation already claimed', async () => {
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockClaimByMetadata.mockResolvedValue(null);

    const result = await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(result.status).toBe(409);
  });

  it('returns 400 when key or value missing', async () => {
    const result = await claimByMetadata({ key: 'orderId', value: '' }, SYSTEM_AUTH);
    expect(result.status).toBe(400);
  });

  it('passes metadata to service claimByMetadata for atomic merge', async () => {
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false });

    const result = await claimByMetadata({
      key: 'orderId', value: 'order-123',
      metadata: { claimedBy: 'jimbo', station: 'scanning' },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(200);
    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined,
      { claimedBy: 'jimbo', station: 'scanning' },
    );
  });

  it('passes undefined metadata when omitted', async () => {
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockClaimByMetadata.mockResolvedValue({ escalation: esc as any, isExtension: false });

    await claimByMetadata({ key: 'orderId', value: 'order-123' }, SYSTEM_AUTH);

    expect(mockClaimByMetadata).toHaveBeenCalledWith(
      'orderId', 'order-123', 'system-uuid', undefined, undefined,
    );
  });
});

// ── resolveByMetadata ───────────────────────────────────────────────────

describe('resolveByMetadata', () => {
  it('returns 404 when no pending escalation found', async () => {
    mockFindByMetadata.mockResolvedValue({ escalations: [], total: 0 });

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(404);
  });

  it('auto-claims when unclaimed before resolving', async () => {
    const esc = makeEscalation({ assigned_to: null, assigned_until: null });
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockClaimEscalation.mockResolvedValue({ escalation: esc as any, isExtension: false });

    // Mock the resolve import
    vi.doMock('../../api/escalations/resolve', () => ({
      resolveEscalation: vi.fn().mockResolvedValue({ status: 200, data: { resolved: true } }),
    }));

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(mockClaimEscalation).toHaveBeenCalledWith('esc-uuid', 'system-uuid', 5);
  });

  it('returns 400 when resolverPayload missing', async () => {
    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: undefined as any,
    }, SYSTEM_AUTH);

    expect(result.status).toBe(400);
  });

  it('resolves assignee from external_id', async () => {
    const esc = makeEscalation({ assigned_to: null });
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockGetUserByExternalId.mockResolvedValue({ id: 'resolved-uuid' } as any);
    mockClaimEscalation.mockResolvedValue({ escalation: esc as any, isExtension: false });

    vi.doMock('../../api/escalations/resolve', () => ({
      resolveEscalation: vi.fn().mockResolvedValue({ status: 200, data: { resolved: true } }),
    }));

    await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true }, assignee: 'ext-42',
    }, SYSTEM_AUTH);

    expect(mockGetUserByExternalId).toHaveBeenCalledWith('ext-42');
  });

  it('returns 403 when non-superadmin lacks role', async () => {
    mockIsSuperAdmin.mockResolvedValue(false);
    const esc = makeEscalation();
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockHasRole.mockResolvedValue(false);

    const result = await resolveByMetadata({
      key: 'orderId', value: 'order-123', resolverPayload: { approved: true },
    }, SYSTEM_AUTH);

    expect(result.status).toBe(403);
  });

  it('merges metadata on resolve when provided', async () => {
    const esc = makeEscalation({ assigned_to: 'system-uuid', assigned_until: new Date(Date.now() + 60000) });
    mockFindByMetadata.mockResolvedValue({ escalations: [esc as any], total: 1 });
    mockUpdateMetadata.mockResolvedValue(esc as any);

    vi.doMock('../../api/escalations/resolve', () => ({
      resolveEscalation: vi.fn().mockResolvedValue({ status: 200, data: { resolved: true } }),
    }));

    await resolveByMetadata({
      key: 'orderId', value: 'order-123',
      resolverPayload: { approved: true },
      metadata: { completedBy: 'jimbo' },
    }, SYSTEM_AUTH);

    expect(mockUpdateMetadata).toHaveBeenCalledWith('esc-uuid', { completedBy: 'jimbo' });
  });
});
