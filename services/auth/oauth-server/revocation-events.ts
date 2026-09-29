import { eventRegistry } from '../../../lib/events';
import { loggerRegistry } from '../../../lib/logger';
import type { CallbackEventAdapter } from '../../../lib/events/callback';
import { markRevoked } from './revocations';

/**
 * Revocations reach every process over the event bus. The revoking process
 * marks the grant at once; the others mark it when the event arrives, which
 * needs a cross-process transport (NATS, for example). Without one, the
 * access-token lifetime bounds how long other processes accept the token.
 */

export const OAUTH_EVENTS = {
  GRANT_REVOKED: 'system.oauth.grant.revoked',
} as const;

/** Revoke a grant's access tokens here now, and everywhere the event reaches. */
export function revokeEverywhere(grantId: string): void {
  markRevoked({ grantId });
  eventRegistry.publish({
    type: OAUTH_EVENTS.GRANT_REVOKED,
    timestamp: new Date().toISOString(),
    source: 'oauth-server',
    data: { grantId },
  }).catch((err: any) => {
    loggerRegistry.warn(`[lt-oauth] revocation event not published: ${err?.message}`);
  });
}

/** Mark grants revoked in this process as their events arrive. Returns the unsubscribe. */
export function listenForRevocations(adapter: CallbackEventAdapter): () => void {
  return adapter.on(OAUTH_EVENTS.GRANT_REVOKED, (event) => {
    const grantId = event.data?.grantId;
    if (typeof grantId === 'string') markRevoked({ grantId });
  });
}
