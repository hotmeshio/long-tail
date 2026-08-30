import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseMyRoles = vi.fn();
const mockUseRoleDetails = vi.fn();
const mockUseStationRole = vi.fn();
vi.mock('../useAuth', () => ({ useAuth: () => ({ user: { userId: 'u' } }) }));
vi.mock('../../api/users', () => ({ useMyRoles: () => mockUseMyRoles() }));
vi.mock('../../api/roles', () => ({ useRoleDetails: () => mockUseRoleDetails() }));
vi.mock('../../lib/station-role-store', () => ({
  useStationRole: (uid: string | null) => mockUseStationRole(uid),
  setSelectedRole: vi.fn(),
}));

import { useKioskMode, isKioskAllowedPath } from '../useKioskMode';

const membership = (role: string, over: Record<string, unknown> = {}) => ({
  role, type: 'member', read_scope: 'all', write_scope: 'none', created_at: 'now', ...over,
});
const rolesOf = (...roles: unknown[]) => mockUseMyRoles.mockReturnValue({ data: roles });

beforeEach(() => {
  vi.clearAllMocks();
  mockUseStationRole.mockReturnValue(null);
  mockUseMyRoles.mockReturnValue({ data: [] });
  mockUseRoleDetails.mockReturnValue({
    data: { roles: [
      { role: 'gluer', properties: { kiosk: true } },
      { role: 'packer', properties: { kiosk: true } },
      { role: 'finisher', properties: {} },
    ] },
  });
});

describe('useKioskMode', () => {
  it('engages for a single-role member of a kiosk role, with the role list as home', () => {
    rolesOf(membership('gluer'));
    const { result } = renderHook(() => useKioskMode());
    expect(result.current.kiosk).toBe(true);
    expect(result.current.role).toBe('gluer');
    expect(result.current.homePath).toBe('/escalations/available?role=gluer&status=available');
  });

  it('stays off when the role does not opt in', () => {
    rolesOf(membership('finisher'));
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });

  it('stays off for admin-type grants even on a kiosk role', () => {
    rolesOf(membership('gluer', { type: 'admin' }));
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });

  it('stays off before role details load (safe default: full chrome)', () => {
    mockUseRoleDetails.mockReturnValue({ data: undefined });
    rolesOf(membership('gluer'));
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });

  it('auto-locks a multi-role readonly station with a single kiosk target', () => {
    rolesOf(membership('gluer'), membership('finisher'));
    const { result } = renderHook(() => useKioskMode());
    expect(result.current.kiosk).toBe(true);
    expect(result.current.role).toBe('gluer');
    expect(result.current.selectable).toBe(false);
  });

  it('stays in full chrome but offers the picker when several targets and none chosen', () => {
    rolesOf(membership('gluer'), membership('packer'), membership('finisher'));
    const { result } = renderHook(() => useKioskMode());
    expect(result.current.kiosk).toBe(false);
    expect(result.current.selectable).toBe(true);
    expect(result.current.targets).toEqual(['gluer', 'packer']);
  });

  it('locks to the stored station selection when it is a valid target', () => {
    mockUseStationRole.mockReturnValue('packer');
    rolesOf(membership('gluer'), membership('packer'), membership('finisher'));
    const { result } = renderHook(() => useKioskMode());
    expect(result.current.kiosk).toBe(true);
    expect(result.current.role).toBe('packer');
    expect(result.current.selectable).toBe(true);
  });

  it('stays in full chrome for a multi-role account that can write (an operator, not a station)', () => {
    rolesOf(membership('gluer'), membership('packer', { write_scope: 'self' }));
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });
});

describe('isKioskAllowedPath', () => {
  it('allows the list, detail, and scan screens', () => {
    expect(isKioskAllowedPath('/escalations/available')).toBe(true);
    expect(isKioskAllowedPath('/escalations/detail/abc-123')).toBe(true);
    expect(isKioskAllowedPath('/scan/station')).toBe(true);
    expect(isKioskAllowedPath('/login')).toBe(true);
  });

  it('locks out home and every other surface', () => {
    for (const path of ['/', '/operations', '/workflows', '/admin/roles', '/capabilities']) {
      expect(isKioskAllowedPath(path)).toBe(false);
    }
  });
});
