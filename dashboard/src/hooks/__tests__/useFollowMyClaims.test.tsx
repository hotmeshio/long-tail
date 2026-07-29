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

/**
 * A born-assigned (directed) hand-off `claimed` event: the follow-on `childId`
 * is assigned to `assignedTo` and descends from `parentId`. `assignedAtCreation`
 * true distinguishes it from an interactive claim.
 */
const handoffEvent = (
  childId: string,
  assignedTo: string,
  parentId: string,
  assignedAtCreation: boolean | undefined = true,
) => ({
  type: `system.escalation.role.${childId}.claimed`,
  escalationId: childId,
  status: 'claimed',
  assignedAtCreation,
  data: { assigned_to: assignedTo, parent_id: parentId, id: childId },
});

function mount(pathname = '/escalations/available') {
  state.pathname = pathname;
  return renderHook(() => useFollowMyClaims());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useFollowMyClaims — the directed hand-off', () => {
  it('monitors claimed-verb subjects for the member roles', () => {
    mount();
    expect(captured.patterns.length).toBeGreaterThan(0);
    expect(captured.patterns.every((p) => p.endsWith('.claimed'))).toBe(true);
  });

  it('navigates to the born-assigned child when on its parent detail page', () => {
    mount('/escalations/detail/esc-parent');
    captured.handler(handoffEvent('esc-child', 'me', 'esc-parent'));
    expect(navigateSpy).toHaveBeenCalledWith('/escalations/detail/esc-child');
  });

  it('does not navigate when the viewer is not on the parent page', () => {
    mount('/escalations/available');
    captured.handler(handoffEvent('esc-child', 'me', 'esc-parent'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does not navigate when the child descends from a different escalation', () => {
    mount('/escalations/detail/esc-other');
    captured.handler(handoffEvent('esc-child', 'me', 'esc-parent'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores interactive claims (assignedAtCreation false or absent)', () => {
    mount('/escalations/detail/esc-parent');
    captured.handler(handoffEvent('esc-child', 'me', 'esc-parent', false));
    // Field entirely absent (an ordinary interactive claim) — built inline so
    // the helper default cannot reintroduce the marker.
    captured.handler({
      type: 'system.escalation.role.esc-child.claimed',
      escalationId: 'esc-child',
      status: 'claimed',
      data: { assigned_to: 'me', parent_id: 'esc-parent', id: 'esc-child' },
    });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores hand-offs assigned to someone else', () => {
    mount('/escalations/detail/esc-parent');
    captured.handler(handoffEvent('esc-child', 'someone-else', 'esc-parent'));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores malformed events with no assignee', () => {
    mount('/escalations/detail/esc-parent');
    captured.handler({ type: 'x.claimed', escalationId: 'esc-child', assignedAtCreation: true, data: { parent_id: 'esc-parent' } });
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
