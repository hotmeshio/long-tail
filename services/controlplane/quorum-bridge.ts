import type { QuorumMessageCallback } from '@hotmeshio/hotmesh/build/types/quorum';

import { eventRegistry } from '../events';
import { loggerRegistry } from '../logger';
import type { LTEvent } from '../../types';

/**
 * Bridge HotMesh quorum messages to the NATS event system.
 *
 * Subscribes to a HotMesh engine's quorum channel via `subQuorum()`
 * and republishes each message as an `LTEvent` on `lt.mesh.{type}`.
 *
 * Topic mapping:
 *   quorum type "pong"     → lt.mesh.pong
 *   quorum type "throttle" → lt.mesh.throttle
 *   quorum type "job"      → lt.mesh.job
 *   quorum type "ping"     → lt.mesh.ping
 *   quorum type "work"     → lt.mesh.work
 *   quorum type "activate" → lt.mesh.activate
 *   quorum type "cron"     → lt.mesh.cron
 *   quorum type "user"     → lt.mesh.user
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
