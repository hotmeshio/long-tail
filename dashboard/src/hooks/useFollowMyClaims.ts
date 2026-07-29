import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { useEventSubscriptions } from './useEventContext';
import { useMemberEscalationPatterns } from './useMemberEscalationPatterns';

const DETAIL_PREFIX = '/escalations/detail/';

/** The escalation id the viewer is currently on, or undefined off a detail page. */
function currentEscalationId(pathname: string): string | undefined {
  if (!pathname.startsWith(DETAIL_PREFIX)) return undefined;
  const rest = pathname.slice(DETAIL_PREFIX.length);
  const id = rest.split('/')[0];
  return id || undefined;
}

/**
 * The chained hand-off: when the escalation the viewer is currently looking at
 * spawns a follow-on that is BORN ASSIGNED to them, land them on it. The engine
 * states the hand-off definitively — a `claimed` event carrying
 * `assignedAtCreation === true` (a directed, system-issued assignment, not an
 * interactive claim), `data.assigned_to === viewer`, and `data.parent_id` equal
 * to the escalation on screen. All three must hold, so an unrelated assignment
 * or a claim the viewer made themselves can never redirect them. Navigation is
 * scoped to being on the parent's page, so nothing yanks a viewer working
 * elsewhere. The submitting form's `x-lt-transition` shows a wait screen across
 * the brief gap; this hook is what ends it.
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
    // Only a directed, born-assigned hand-off pulls the viewer — never an
    // interactive claim (assignedAtCreation false/absent) they observe.
    if (event?.assignedAtCreation !== true) return;
    const childId: string | undefined = event?.escalationId ?? event?.data?.id;
    const assignedTo: string | undefined = event?.data?.assigned_to;
    const parentId: string | undefined = event?.data?.parent_id;
    if (!childId || assignedTo !== userIdRef.current) return;
    // The child must descend from the escalation on screen — the hand-off from
    // what the viewer just did, not some other assignment that happened to land.
    if (!parentId || parentId !== currentEscalationId(pathRef.current)) return;
    const target = `${DETAIL_PREFIX}${childId}`;
    if (pathRef.current !== target) navigate(target);
  }, [navigate]);

  useEventSubscriptions(useMemberEscalationPatterns(['claimed']), handler);
}
