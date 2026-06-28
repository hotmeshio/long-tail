import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/escalation');
vi.mock('../../services/user');

import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { searchByFacets, claimByFacets, claimGroups } from '../../api/escalations/facets';

const mockHasGlobalAccess = vi.mocked(userService.hasGlobalEscalationAccess);
const mockGetRoleScope = vi.mocked(userService.getRoleScope);
const mockSearch = vi.mocked(escalationService.searchByFacets);
const mockClaimByFacets = vi.mocked(escalationService.claimByFacets);
const mockClaimGroups = vi.mocked(escalationService.claimGroups);

const AUTH = { userId: 'u1' };
const query = { role: 'operator' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockHasGlobalAccess.mockResolvedValue(false);
});

// Faceted routing is the whole-pond dispatcher pattern: search surfaces other
// operators' items (needs read_all) and claim takes unassigned work (needs write_all).
describe('faceted RBAC — pond scope gates', () => {
  it('searchByFacets allows a read_all member', async () => {
    mockGetRoleScope.mockResolvedValue({ read: 'all', write: 'all' } as any);
    mockSearch.mockResolvedValue({ escalations: [], total: 0 } as any);
    expect((await searchByFacets(query, AUTH)).status).toBe(200);
  });

  it('searchByFacets denies a read_self member (403, no pond read)', async () => {
    mockGetRoleScope.mockResolvedValue({ read: 'self', write: 'self' } as any);
    const r = await searchByFacets(query, AUTH);
    expect(r.status).toBe(403);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('claimByFacets requires write_all — a write_self member is denied (403)', async () => {
    mockGetRoleScope.mockResolvedValue({ read: 'all', write: 'self' } as any);
    const r = await claimByFacets({ query }, AUTH);
    expect(r.status).toBe(403);
    expect(mockClaimByFacets).not.toHaveBeenCalled();
  });

  it('claimByFacets allows a write_all member', async () => {
    mockGetRoleScope.mockResolvedValue({ read: 'all', write: 'all' } as any);
    mockClaimByFacets.mockResolvedValue([] as any);
    expect((await claimByFacets({ query }, AUTH)).status).toBe(200);
  });

  it('claimGroups requires write_all — a write_self member is denied (403)', async () => {
    mockGetRoleScope.mockResolvedValue({ read: 'all', write: 'self' } as any);
    const r = await claimGroups({ query }, AUTH);
    expect(r.status).toBe(403);
    expect(mockClaimGroups).not.toHaveBeenCalled();
  });

  it('a non-member is denied search and claim', async () => {
    mockGetRoleScope.mockResolvedValue(undefined as any);
    expect((await searchByFacets(query, AUTH)).status).toBe(403);
    expect((await claimByFacets({ query }, AUTH)).status).toBe(403);
  });

  it('global access bypasses both gates', async () => {
    mockHasGlobalAccess.mockResolvedValue(true);
    mockSearch.mockResolvedValue({ escalations: [], total: 0 } as any);
    mockClaimByFacets.mockResolvedValue([] as any);
    expect((await searchByFacets(query, AUTH)).status).toBe(200);
    expect((await claimByFacets({ query }, AUTH)).status).toBe(200);
  });
});
