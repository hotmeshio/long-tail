import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  bulkAssignEscalations: vi.fn(),
  bulkAssignEscalationsByQuery: vi.fn(),
  bulkReassignEscalations: vi.fn(),
  bulkUnassignEscalations: vi.fn(),
  getEscalationRoles: vi.fn(),
}));
vi.mock('../../../services/user', () => ({ hasRole: vi.fn() }));
vi.mock('../../../api/escalations/helpers', () => ({
  validateIds: (ids: unknown) => Array.isArray(ids) && ids.length > 0,
  checkBulkPermission: vi.fn(async () => ({ allowed: true })),
  publishBulkClaimEvents: vi.fn(),
  publishBulkReassignEvents: vi.fn(),
  publishBulkReleaseEvents: vi.fn(),
  hasGlobalEscalationAccess: vi.fn(),
}));
vi.mock('../../../workers', () => ({ createClient: vi.fn() }));
vi.mock('../../../services/task', () => ({ getTask: vi.fn(), createTask: vi.fn() }));
vi.mock('../../../modules/defaults', () => ({ JOB_EXPIRE_SECS: 3600 }));

import * as svc from '../../../services/escalation';
import {
  hasGlobalEscalationAccess,
  publishBulkClaimEvents,
  publishBulkReleaseEvents,
} from '../../../api/escalations/helpers';
import { bulkAssign, bulkUnassign } from '../../../api/escalations/bulk';

const mockReassign = vi.mocked(svc.bulkReassignEscalations);
const mockUnassign = vi.mocked(svc.bulkUnassignEscalations);
const mockGlobal = vi.mocked(hasGlobalEscalationAccess);
const mockClaimEvents = vi.mocked(publishBulkClaimEvents);
const mockReleaseEvents = vi.mocked(publishBulkReleaseEvents);

const AUTH = { userId: 'admin-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mockGlobal.mockResolvedValue(true);
});

describe('bulkAssign — reassign takeover', () => {
  it('requires admin access — a role-scoped caller gets 403', async () => {
    mockGlobal.mockResolvedValue(false);
    const result = await bulkAssign(
      { ids: ['e1'], targetUserId: 'u2', reassign: true },
      AUTH,
    );
    expect(result.status).toBe(403);
    expect(mockReassign).not.toHaveBeenCalled();
  });

  it('rejects the query form — reassign is ids-only', async () => {
    const result = await bulkAssign(
      { query: { role: 'station' }, targetUserId: 'u2', reassign: true },
      AUTH,
    );
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/ids form/);
  });

  it('takes over and publishes claimed events carrying the displaced assignee', async () => {
    mockReassign.mockResolvedValue({
      assigned: 2,
      skipped: 1,
      changes: [
        { id: 'e1', role: 'station', prior_assignee: 'u-old' },
        { id: 'e2', role: 'station', prior_assignee: null },
      ],
    });
    const result = await bulkAssign(
      { ids: ['e1', 'e2', 'e3'], targetUserId: 'u2', durationMinutes: 45, reassign: true },
      AUTH,
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ assigned: 2, skipped: 1 });
    expect(mockReassign).toHaveBeenCalledWith(['e1', 'e2', 'e3'], 'u2', 45);
    const [ids, target, , priorById] = mockClaimEvents.mock.calls[0];
    expect(ids).toEqual(['e1', 'e2']);
    expect(target).toBe('u2');
    expect(priorById?.get('e1')).toBe('u-old');
  });

  it('without the flag, plain assign still runs the skip-semantics path', async () => {
    vi.mocked(svc.bulkAssignEscalations).mockResolvedValue({ assigned: 1, skipped: 0 });
    mockGlobal.mockResolvedValue(false);
    vi.mocked(svc.getEscalationRoles).mockResolvedValue(['station']);
    const { hasRole } = await import('../../../services/user');
    vi.mocked(hasRole).mockResolvedValue(true);

    const result = await bulkAssign({ ids: ['e1'], targetUserId: 'u2' }, AUTH);
    expect(result.status).toBe(200);
    expect(svc.bulkAssignEscalations).toHaveBeenCalled();
    expect(mockReassign).not.toHaveBeenCalled();
  });
});

describe('bulkUnassign', () => {
  it('requires admin access', async () => {
    mockGlobal.mockResolvedValue(false);
    const result = await bulkUnassign({ ids: ['e1'] }, AUTH);
    expect(result.status).toBe(403);
  });

  it('validates ids', async () => {
    const result = await bulkUnassign({ ids: [] }, AUTH);
    expect(result.status).toBe(400);
  });

  it('returns rows to the pool and publishes released events with the acting admin', async () => {
    mockUnassign.mockResolvedValue({
      unassigned: 1,
      skipped: 1,
      changes: [{ id: 'e1', role: 'station', prior_assignee: 'u-old' }],
    });
    const result = await bulkUnassign({ ids: ['e1', 'e2'] }, AUTH);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ unassigned: 1, skipped: 1 });
    expect(mockReleaseEvents).toHaveBeenCalledWith(
      [{ id: 'e1', role: 'station', prior_assignee: 'u-old' }],
      'admin-1',
    );
  });
});
