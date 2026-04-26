import * as controlplane from '../services/controlplane';
import { eventRegistry } from '../lib/events';
import type { LTEvent } from '../types';
import type { LTApiResult } from '../types/sdk';

/**
 * List all registered application namespaces.
 *
 * @returns `{ status: 200, data: { apps } }` array of known app identifiers
 */
export async function listApps(): Promise<LTApiResult> {
  try {
    const apps = await controlplane.listApps();
    return { status: 200, data: { apps } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Query active worker profiles for an application.
 *
 * Sends a roll-call request to the mesh and collects responses from
 * all running workers within the optional delay window.
 *
 * @param input.appId — application namespace to query (defaults to 'durable')
 * @param input.delay — milliseconds to wait for worker responses before returning
 * @returns `{ status: 200, data: { profiles } }` array of worker profile objects
 */
export async function rollCall(input: {
  appId?: string;
  delay?: number;
}): Promise<LTApiResult> {
  try {
    const appId = input.appId || 'durable';
    const profiles = await controlplane.rollCall(appId, input.delay);
    return { status: 200, data: { profiles } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Apply a throttle rate to workflow execution.
 *
 * Sets the throttle value for a specific topic or workflow within an app
 * namespace. Also publishes a synthetic `mesh.throttle` event so the
 * dashboard event stream reflects the change.
 *
 * @param input.appId — application namespace (defaults to 'durable')
 * @param input.throttle — throttle value to apply (required, must be a number)
 * @param input.topic — optional topic to scope the throttle to
 * @param input.guid — optional workflow GUID to scope the throttle to
 * @returns `{ status: 200, data: { success } }` boolean indicating the throttle was applied
 */
export async function applyThrottle(input: {
  appId?: string;
  throttle: number;
  topic?: string;
  guid?: string;
}): Promise<LTApiResult> {
  try {
    const appId = input.appId || 'durable';

    if (typeof input.throttle !== 'number') {
      return { status: 400, error: 'throttle (number) is required' };
    }

    const result = await controlplane.applyThrottle(appId, {
      throttle: input.throttle,
      topic: input.topic,
      guid: input.guid,
    });

    // Publish a synthetic event so the dashboard event stream sees it
    const throttleEvent: LTEvent = {
      type: 'mesh.throttle' as any,
      source: 'controlplane',
      workflowId: input.guid || '',
      workflowName: '',
      taskQueue: appId,
      data: { throttle: input.throttle, topic: input.topic, guid: input.guid, appId },
      timestamp: new Date().toISOString(),
    };
    eventRegistry.publish(throttleEvent).catch(() => {});

    return { status: 200, data: { success: result } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve stream statistics for an application.
 *
 * Returns throughput and backlog metrics for Redis streams backing the
 * given app namespace over the specified time window.
 *
 * @param input.app_id — application namespace (defaults to 'durable')
 * @param input.duration — time window for stats aggregation, e.g. '1h', '30m' (defaults to '1h')
 * @param input.stream — optional specific stream name to filter results
 * @returns `{ status: 200, data: { ... } }` stream statistics object
 */
export async function getStreamStats(input: {
  app_id?: string;
  duration?: string;
  stream?: string;
}): Promise<LTApiResult> {
  try {
    const schema = input.app_id || 'durable';
    const duration = input.duration || '1h';
    const stats = await controlplane.getStreamStats(schema, duration, input.stream);
    return { status: 200, data: stats };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Subscribe to mesh events for an application.
 *
 * Establishes a subscription to the event stream of the given app
 * namespace so that mesh events are captured and forwarded.
 *
 * @param input.appId — application namespace to subscribe to (defaults to 'durable')
 * @returns `{ status: 200, data: { subscribed, appId } }` confirmation with the subscribed app ID
 */
export async function subscribeMesh(input: {
  appId?: string;
}): Promise<LTApiResult> {
  try {
    const appId = input.appId || 'durable';
    await controlplane.subscribeMesh(appId);
    return { status: 200, data: { subscribed: true, appId } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
