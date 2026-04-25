import * as controlplane from '../services/controlplane';
import { eventRegistry } from '../lib/events';
import type { LTEvent } from '../types';
import type { LTApiResult } from '../types/sdk';

export async function listApps(): Promise<LTApiResult> {
  try {
    const apps = await controlplane.listApps();
    return { status: 200, data: { apps } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

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
