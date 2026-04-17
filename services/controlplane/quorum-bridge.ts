import type { QuorumMessageCallback } from '@hotmeshio/hotmesh/build/types/quorum';

import { eventRegistry } from '../../lib/events';
import { loggerRegistry } from '../../lib/logger';
import type { LTEvent } from '../../types';

/**
 * Bridge HotMesh quorum messages to the NATS event system.
 *
 * Subscribes to a HotMesh engine's quorum channel via `subQuorum()`
 * and republishes each message as an `LTEvent` on `lt.mesh.{type}`.
 *
 * Topic mapping (quorum subscription receives these types):
 *   quorum type "pong"     → lt.events.mesh.pong
 *   quorum type "ping"     → lt.events.mesh.ping
 *   quorum type "job"      → lt.events.mesh.job
 *   quorum type "work"     → lt.events.mesh.work
 *   quorum type "activate" → lt.events.mesh.activate
 *   quorum type "cron"     → lt.events.mesh.cron
 *   quorum type "user"     → lt.events.mesh.user
 *
 * Note: throttle commands don't echo through the quorum subscription.
 * The throttle route publishes a synthetic event directly to NATS.
 */

let activeCallback: QuorumMessageCallback | null = null;

/**
 * Create a quorum callback that republishes messages to NATS.
 */
export function createQuorumBridgeCallback(appId: string): QuorumMessageCallback {
  const callback: QuorumMessageCallback = (_topic, message) => {
    const type = message.type || 'unknown';

    const event: LTEvent = {
      type: `mesh.${type}` as any,
      source: 'controlplane',
      workflowId: (message as any).guid || '',
      workflowName: '',
      taskQueue: appId,
      data: message as any,
      timestamp: new Date().toISOString(),
    };

    eventRegistry.publish(event).catch(() => {
      // fire-and-forget — NATS publish failures are non-critical
    });
  };

  activeCallback = callback;
  return callback;
}

/**
 * Get the active quorum bridge callback (for unsubscription).
 */
export function getActiveCallback(): QuorumMessageCallback | null {
  return activeCallback;
}

/**
 * Start the quorum bridge for a given HotMesh engine.
 */
export async function startQuorumBridge(
  engine: { subQuorum: (cb: QuorumMessageCallback) => Promise<void> },
  appId: string,
): Promise<void> {
  const callback = createQuorumBridgeCallback(appId);
  await engine.subQuorum(callback);
  loggerRegistry.info(`[controlplane] quorum bridge active for ${appId} → lt.mesh.*`);
}
