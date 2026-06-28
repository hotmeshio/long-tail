import { describe, it, expect, vi, beforeEach } from 'vitest';

// Keep the pure scope helpers (effectiveScope) real — getEscalationWriteScope
// partitions roles through them; only stub the DB-touching user functions.
vi.mock('../../services/escalation');
vi.mock('../../services/user', async (importActual) => {
  const actual = await importActual<typeof import('../../services/user')>();
  return { ...actual, hasGlobalEscalationAccess: vi.fn(), getUserRoles: vi.fn() };
});
vi.mock('../../services/task');
vi.mock('../../services/escalation-strategy', () => ({
  escalationStrategyRegistry: { current: null },
}));
vi.mock('../../services/yaml-workflow/deployer', () => ({ getEngine: vi.fn() }));
vi.mock('../../lib/events/publish', () => ({ publishEscalationEvent: vi.fn() }));
vi.mock('../../services/iam/ephemeral', () => ({
  storeEphemeral: vi.fn(),
  formatEphemeralToken: vi.fn(),
}));
vi.mock('../../workers', () => ({ createClient: () => ({ workflow: {} }) }));

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { resolveByIds } from '../../api/escalations/resolve';

const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetUserRoles = vi.mocked(userService.getUserRoles);
const mockGetScopeRows = vi.mocked(escalationService.getEscalationScopeRows);
const mockResolveByIds = vi.mocked(escalationService.resolveEscalationsByIds);

const AUTH = { userId: 'u1' };
const roleWith = (write: 'all' | 'self') =>
  [{ role: 'operator', type: 'member', read_scope: 'all', write_scope: write } as any];

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobalAccess.mockResolvedValue(false);
});

describe('resolveByIds — per-item write scope', () => {
  it('a write_self member resolves an item assigned to them', async () => {
    mockGetUserRoles.mockResolvedValue(roleWith('self'));
    mockGetScopeRows.mockResolvedValue([{ id: 'e1', role: 'operator', assigned_to: 'u1' }]);
    mockResolveByIds.mockResolvedValue([{ id: 'e1' } as any]);

    const r = await resolveByIds({ ids: ['e1'], resolverPayload: { ok: true } }, AUTH);
    expect(r.status).toBe(200);
    expect(mockResolveByIds).toHaveBeenCalled();
  });

  it('a write_self member is denied an item assigned to someone else (404)', async () => {
    mockGetUserRoles.mockResolvedValue(roleWith('self'));
    mockGetScopeRows.mockResolvedValue([{ id: 'e1', role: 'operator', assigned_to: 'someone-else' }]);

    const r = await resolveByIds({ ids: ['e1'], resolverPayload: { ok: true } }, AUTH);
    expect(r.status).toBe(404);
    expect(mockResolveByIds).not.toHaveBeenCalled();
  });

  it('a write_all member resolves any item in the role', async () => {
    mockGetUserRoles.mockResolvedValue(roleWith('all'));
    mockGetScopeRows.mockResolvedValue([{ id: 'e1', role: 'operator', assigned_to: 'someone-else' }]);
    mockResolveByIds.mockResolvedValue([{ id: 'e1' } as any]);

    const r = await resolveByIds({ ids: ['e1'], resolverPayload: { ok: true } }, AUTH);
    expect(r.status).toBe(200);
  });

  it('a missing id (fewer rows than ids) → 404, nothing resolved', async () => {
    mockGetUserRoles.mockResolvedValue(roleWith('all'));
    mockGetScopeRows.mockResolvedValue([{ id: 'e1', role: 'operator', assigned_to: 'u1' }]); // 1 of 2

    const r = await resolveByIds({ ids: ['e1', 'e2'], resolverPayload: { ok: true } }, AUTH);
    expect(r.status).toBe(404);
    expect(mockResolveByIds).not.toHaveBeenCalled();
  });

  it('global access bypasses the per-item check entirely', async () => {
    mockHasGlobalAccess.mockResolvedValue(true);
    mockResolveByIds.mockResolvedValue([{ id: 'e1' } as any]);

    const r = await resolveByIds({ ids: ['e1'], resolverPayload: { ok: true } }, AUTH);
    expect(r.status).toBe(200);
    expect(mockGetScopeRows).not.toHaveBeenCalled();
  });
});
