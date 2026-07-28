import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useEventSubscriptions } from './useEventContext';
import { useMemberEscalationPatterns } from './useMemberEscalationPatterns';

/**
 * The claim hand-off: monitor `system.escalation.<role>.*.claimed` across the
 * viewer's roles, and when the payload's assignee is the viewer, navigate to
 * that escalation's detail page. Pre-assignment is the system saying "this is
 * yours next" — a resolve → side-effect → follow-on chain lands the user on
 * the next step instead of history's previous page. Claims the user made
 * themselves resolve to the page they already navigated to, so the gesture is
 * naturally idempotent.
 */
export function useFollowMyClaims(): void {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // The handler reads live values through refs — subscriptions stay stable
  // across route changes instead of resubscribing on every navigation.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const userIdRef = useRef(user?.userId);
  userIdRef.current = user?.userId;

  const handler = useCallback((event: any) => {
    const id: string | undefined = event?.escalationId;
    const assignedTo: string | undefined = event?.data?.assigned_to;
    if (!id || !assignedTo || assignedTo !== userIdRef.current) return;
    const target = `/escalations/detail/${id}`;
    if (pathRef.current !== target) navigate(target);
  }, [navigate]);

  useEventSubscriptions(useMemberEscalationPatterns(['claimed']), handler);
}
