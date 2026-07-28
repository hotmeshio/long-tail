import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const navigateSpy = vi.fn();
const state = { pathname: '/escalations/available' };
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateSpy,
  useLocation: () => ({ pathname: state.pathname }),
}));

vi.mock('../useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'me', roles: [{ role: 'print-harvest' }] },
    isSuperAdmin: false,
    hasRoleType: () => false,
  }),
}));

// Capture the subscription so tests can fire events through the handler.
const captured: { patterns: string[]; handler: (e: any) => void } = { patterns: [], handler: () => {} };
vi.mock('../useEventContext', () => ({
  useEventSubscriptions: (patterns: string[], handler: (e: any) => void) => {
    captured.patterns = patterns;
    captured.handler = handler;
  },
}));

import { useFollowMyClaims } from '../useFollowMyClaims';

const claimedEvent = (id: string, assignedTo: string) => ({
  type: `system.escalation.${id}.claimed`,
  escalationId: id,
  status: 'claimed',
  data: { assigned_to: assignedTo },
});

function mount(pathname = '/escalations/available') {
  state.pathname = pathname;
  return renderHook(() => useFollowMyClaims());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFollowMyClaims — the claim hand-off', () => {
  it('monitors claimed-verb subjects for the member roles', () => {
    mount();
    expect(captured.patterns.length).toBeGreaterThan(0);
    expect(captured.patterns.every((p) => p.endsWith('.claimed'))).toBe(true);
  });

  it('navigates to the detail page when an item is claimed in my name', () => {
    mount('/escalations/available');
    captured.handler(claimedEvent('esc-9', 'me'));
    expect(navigateSpy).toHaveBeenCalledWith('/escalations/detail/esc-9');
  });

  it('follows from anywhere — including another detail page', () => {
    mount('/escalations/detail/esc-current');
    captured.handler(claimedEvent('esc-next', 'me'));
    expect(navigateSpy).toHaveBeenCalledWith('/escalations/detail/esc-next');
  });

  it('ignores claims assigned to someone else', () => {
    mount();
    captured.handler(claimedEvent('esc-9', 'someone-else'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('stays put when already on the target detail page', () => {
    mount('/escalations/detail/esc-9');
    captured.handler(claimedEvent('esc-9', 'me'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores malformed events with no assignee', () => {
    mount();
    captured.handler({ type: 'x.claimed', escalationId: 'esc-9', data: {} });
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
