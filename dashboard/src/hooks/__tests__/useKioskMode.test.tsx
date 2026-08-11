import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockUseAuth = vi.fn();
const mockUseRoleDetails = vi.fn();
vi.mock('../useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('../../api/roles', () => ({ useRoleDetails: () => mockUseRoleDetails() }));

import { useKioskMode, isKioskAllowedPath } from '../useKioskMode';

const membership = (role: string, type = 'member') => ({
  role, type, read_scope: 'all', write_scope: 'none', created_at: 'now',
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRoleDetails.mockReturnValue({
    data: { roles: [{ role: 'gluer', properties: { kiosk: true } }, { role: 'finisher', properties: {} }] },
  });
});

describe('useKioskMode', () => {
  it('engages for a single-role member of a kiosk role, with the role list as home', () => {
    mockUseAuth.mockReturnValue({ user: { userId: 'u', roles: [membership('gluer')] } });
    const { result } = renderHook(() => useKioskMode());
    expect(result.current.kiosk).toBe(true);
    expect(result.current.role).toBe('gluer');
    expect(result.current.homePath).toBe('/escalations/available?role=gluer&status=available');
  });

  it('stays off when the role does not opt in', () => {
    mockUseAuth.mockReturnValue({ user: { userId: 'u', roles: [membership('finisher')] } });
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });

  it('stays off for multi-role users — full chrome wins', () => {
    mockUseAuth.mockReturnValue({ user: { userId: 'u', roles: [membership('gluer'), membership('finisher')] } });
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });

  it('stays off for admin-type grants even on a kiosk role', () => {
    mockUseAuth.mockReturnValue({ user: { userId: 'u', roles: [membership('gluer', 'admin')] } });
    expect(renderHook(() => useKioskMode()).result.current.kiosk).toBe(false);
  });

  it('stays off before role details load (safe default: full chrome)', () => {
    mockUseRoleDetails.mockReturnValue({ data: undefined });
    mockUseAuth.mockReturnValue({ user: { userId: 'u', roles: [membership('gluer')] } });
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
