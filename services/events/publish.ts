import type { LTMilestone } from '../../types';
import { eventRegistry } from './index';

/**
 * Publish a milestone event. Called from handleCompletion (workflow
 * interceptor), ltCompleteTask (orchestrator activity), and the
 * activity interceptor's after phase.
 *
 * Fire-and-forget: returns void, never throws. Safe to call from
 * within the durable workflow sandbox (interceptor) or from activities.
 */
export function publishMilestoneEvent(params: {
  source: 'interceptor' | 'orchestrator' | 'activity';
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId?: string;
  activityName?: string;
  milestones: LTMilestone[];
  data?: Record<string, any>;
}): void {
  if (!eventRegistry.hasAdapters) return;
  if (!params.milestones?.length) return;

  eventRegistry
    .publish({
      type: 'milestone',
      source: params.source,
      workflowId: params.workflowId,
      workflowName: params.workflowName,
      taskQueue: params.taskQueue,
      taskId: params.taskId,
      activityName: params.activityName,
      milestones: params.milestones,
      data: params.data,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {
      // swallowed — best-effort
    });
}
