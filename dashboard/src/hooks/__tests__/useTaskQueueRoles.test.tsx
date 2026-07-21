import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../useAuth', () => ({ useAuth: vi.fn() }));

import { useAuth } from '../useAuth';
import { useTaskQueueRoles } from '../useTaskQueueRoles';

const mockAuth = vi.mocked(useAuth);

function withRoles(roles: { role: string; type: string }[]) {
  mockAuth.mockReturnValue({ user: { roles } } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTaskQueueRoles — membership-derived work lanes', () => {
  it('returns the user\'s roles minus the capability tiers, sorted and deduped', () => {
    withRoles([
      { role: 'engineer', type: 'member' },
      { role: 'printer', type: 'member' },
      { role: 'grinder', type: 'member' },
      { role: 'printer', type: 'member' },
    ]);
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual(['grinder', 'printer']);
  });

  it('excludes every capability tier', () => {
    withRoles([
      { role: 'superadmin', type: 'superadmin' },
      { role: 'admin', type: 'admin' },
      { role: 'engineer', type: 'member' },
    ]);
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual([]);
  });

  it('returns empty for a user with no roles', () => {
    withRoles([]);
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual([]);
  });

  it('returns empty when there is no user', () => {
    mockAuth.mockReturnValue({ user: null } as unknown as ReturnType<typeof useAuth>);
    const { result } = renderHook(() => useTaskQueueRoles());
    expect(result.current).toEqual([]);
  });
});
