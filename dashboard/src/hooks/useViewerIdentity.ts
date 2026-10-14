import { useCallback } from 'react';
import { useAuth } from './useAuth';
import { useActingIdentity } from './useActingIdentity';

export interface ViewerIdentity {
  /** Who acts from this screen: the badged person, else the signed-in account. */
  viewerId: string | undefined;
  /** True for the badged person or the signed-in account. */
  isViewer(id: string | null | undefined): boolean;
}

/**
 * The one answer to "is this me" on a screen that a badge can act from. On a
 * shared station every act belongs to the badged person, so work assigned to
 * them is the viewer's as much as work assigned to the session.
 */
export function useViewerIdentity(): ViewerIdentity {
  const { user } = useAuth();
  const { identity } = useActingIdentity();
  const sessionId = user?.userId;
  const actingId = identity?.actorId;
  const isViewer = useCallback(
    (id: string | null | undefined) => !!id && (id === actingId || id === sessionId),
    [actingId, sessionId],
  );
  return { viewerId: actingId ?? sessionId, isViewer };
}
