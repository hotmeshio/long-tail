import type { StreamData, StreamDataResponse } from '@hotmeshio/hotmesh/build/types/stream';

import { loggerRegistry } from '../../logger';
import { publishActivityEvent } from '../../events/publish';
import type { ActivityManifestEntry } from '../../../types/yaml-workflow';

/**
 * Wrap a worker callback with activity lifecycle event publishing.
 * Publishes activity.started before and activity.completed/failed after.
 */
export function wrapWithEvents(
  activity: ActivityManifestEntry,
  appId: string,
  stepIndex: number,
  totalSteps: number,
  callback: (data: StreamData) => Promise<StreamDataResponse>,
): (data: StreamData) => Promise<StreamDataResponse> {
  return async (data: StreamData): Promise<StreamDataResponse> => {
    const meta = data.metadata as { jid?: string; wfn?: string };
    const jid = meta?.jid || 'unknown';
    const wfn = meta?.wfn || appId;
    const eventBase = {
      workflowId: jid,
      workflowName: wfn,
      taskQueue: appId,
      activityName: activity.activity_id,
      data: {
        title: activity.title,
        toolName: activity.mcp_tool_name,
        toolSource: activity.tool_source,
        stepIndex,
        totalSteps,
      },
    };

    publishActivityEvent({ type: 'activity.started', ...eventBase });
    try {
      const result = await callback(data);
      publishActivityEvent({ type: 'activity.completed', ...eventBase });
      return result;
    } catch (err: any) {
      loggerRegistry.error(
        `[yaml-worker] ${activity.activity_id} failed: ${err.message}`,
      );
      publishActivityEvent({
        type: 'activity.failed',
        ...eventBase,
        data: { ...eventBase.data, error: err.message },
      });
      // Return the error as data instead of throwing — prevents HotMesh
      // retry storms when the engine reprocesses failed stream messages.
      return {
        metadata: { ...data.metadata },
        data: { error: err.message, is_error: true },
      };
    }
  };
}
