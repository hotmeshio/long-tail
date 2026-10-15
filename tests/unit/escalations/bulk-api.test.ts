import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  bulkAssignEscalations: vi.fn(),
  bulkAssignEscalationsByQuery: vi.fn(),
  bulkReassignEscalations: vi.fn(),
  bulkUnassignEscalations: vi.fn(),
  getEscalationRoles: vi.fn(),
}));

vi.mock('../../../services/user', () => ({
  hasRole: vi.fn(),
  getRoleScope: vi.fn(),
}));

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
import * as userService from '../../../services/user';
import { hasGlobalEscalationAccess, publishBulkClaimEvents } from '../../../api/escalations/helpers';
import { bulkAssign } from '../../../api/escalations/bulk';

const mockByQuery = vi.mocked(svc.bulkAssignEscalationsByQuery);
const mockHasRole = vi.mocked(userService.hasRole);
const mockRoleScope = vi.mocked(userService.getRoleScope);
const mockGlobal = vi.mocked(hasGlobalEscalationAccess);
const mockPublish = vi.mocked(publishBulkClaimEvents);

const AUTH = { userId: 'admin-1' };

describe('bulkAssign — query form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlobal.mockResolvedValue(true);
    mockByQuery.mockResolvedValue({ assigned: 2, ids: ['e1', 'e2'] });
  });

  it('rejects when both ids and query are provided', async () => {
    const result = await bulkAssign(
      { ids: ['e1'], query: { role: 'harvester' }, targetUserId: 'u1' },
      AUTH,
    );
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/exactly one/);
  });

  it('rejects when neither ids nor query is provided', async () => {
    const result = await bulkAssign({ targetUserId: 'u1' }, AUTH);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/exactly one/);
  });

  it('requires query.role', async () => {
    const result = await bulkAssign(
      { query: { role: '' } as any, targetUserId: 'u1' },
      AUTH,
    );
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/query\.role/);
  });

  it('delegates the selector to the atomic service claim and publishes events', async () => {
    const result = await bulkAssign(
      {
        query: { role: 'harvester', facets: { walkId: 'walk-7' } },
        targetUserId: 'harvester-1',
        durationMinutes: 45,
      },
      AUTH,
    );
    expect(mockByQuery).toHaveBeenCalledWith(
      { role: 'harvester', facets: { walkId: 'walk-7' } },
      'harvester-1',
      45,
    );
    expect(mockPublish).toHaveBeenCalledWith(['e1', 'e2'], 'harvester-1', 'harvester');
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ assigned: 2, skipped: 0 });
  });

  it('non-global caller must hold the queried role (404 non-disclosure)', async () => {
    mockGlobal.mockResolvedValue(false);
    mockRoleScope.mockResolvedValueOnce(null); // caller lacks the role
    const result = await bulkAssign(
      { query: { role: 'harvester' }, targetUserId: 'u1' },
      AUTH,
    );
    expect(result.status).toBe(404);
    expect(mockByQuery).not.toHaveBeenCalled();
  });

  it('non-global: read-only and self-scope members may not assign', async () => {
    mockGlobal.mockResolvedValue(false);
    for (const write of ['none', 'self'] as const) {
      mockRoleScope.mockResolvedValueOnce({ read: 'all', write });
      const result = await bulkAssign({ query: { role: 'harvester' }, targetUserId: 'u1' }, AUTH);
      expect(result.status).toBe(403);
      expect(result.error).toBe('You do not have permission to manage the "harvester" queue');
    }
    expect(mockByQuery).not.toHaveBeenCalled();
  });

  it('non-global: a write-all member may assign within the role', async () => {
    mockGlobal.mockResolvedValue(false);
    mockRoleScope.mockResolvedValueOnce({ read: 'all', write: 'all' });
    mockHasRole.mockResolvedValueOnce(true); // target holds it
    const result = await bulkAssign({ query: { role: 'harvester' }, targetUserId: 'u1' }, AUTH);
    expect(result.status).toBe(200);
    expect(mockRoleScope).toHaveBeenCalledWith(AUTH.userId, 'harvester');
    expect(mockHasRole).toHaveBeenCalledWith('u1', 'harvester');
  });

  it('non-global: target user must hold the queried role', async () => {
    mockGlobal.mockResolvedValue(false);
    mockRoleScope.mockResolvedValueOnce({ read: 'all', write: 'all' });
    mockHasRole.mockResolvedValueOnce(false); // target does not
    const result = await bulkAssign(
      { query: { role: 'harvester' }, targetUserId: 'u1' },
      AUTH,
    );
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not hold/);
    expect(mockByQuery).not.toHaveBeenCalled();
  });

  it('zero matches assigns nothing and publishes nothing', async () => {
    mockByQuery.mockResolvedValue({ assigned: 0, ids: [] });
    const result = await bulkAssign(
      { query: { role: 'harvester', facets: { walkId: 'gone' } }, targetUserId: 'u1' },
      AUTH,
    );
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ assigned: 0, skipped: 0 });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});
