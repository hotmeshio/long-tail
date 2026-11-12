import { loggerRegistry } from '../../lib/logger';
import { publishWorkflowEvent } from '../../lib/events/publish';
import { JOB_STATE, type LTDurableProvider } from '../../types/durable-provider';
import { DURABLE_LOG, FOLLOW_DEFAULTS } from './constants';

const FOLLOW_SOURCE = 'durable-relay';

/**
 * Watches a workflow after an outcome is delivered to it. When the engine
 * reports the workflow closed, publishes `workflow.completed` or
 * `workflow.failed`, the events HotMesh's interceptor publishes, so pages
 * showing the workflow refresh. Stops at the last delay while it still runs.
 */
export class WorkflowFollower {
  private readonly following = new Map<string, NodeJS.Timeout>();
  private stopped = false;

  constructor(
    private readonly provider: LTDurableProvider,
    private readonly delaysMs: readonly number[] = FOLLOW_DEFAULTS.DELAYS_MS,
    private readonly maxFollowed: number = FOLLOW_DEFAULTS.MAX_FOLLOWED,
  ) {}

  /** Workflows being watched now. */
  get size(): number {
    return this.following.size;
  }

  follow(workflowId: string, workflowType: string): void {
    if (this.stopped || this.following.has(workflowId)) return;
    if (this.following.size >= this.maxFollowed) {
      loggerRegistry.warn(DURABLE_LOG.FOLLOW_SKIPPED, { workflowId, following: this.following.size });
      return;
    }
    this.schedule(workflowId, workflowType, 0);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.following.values()) clearTimeout(timer);
    this.following.clear();
  }

  private schedule(workflowId: string, workflowType: string, step: number): void {
    if (step >= this.delaysMs.length) {
      this.following.delete(workflowId);
      return;
    }
    const timer = setTimeout(() => { void this.check(workflowId, workflowType, step); }, this.delaysMs[step]);
    timer.unref?.();
    this.following.set(workflowId, timer);
  }

  private async check(workflowId: string, workflowType: string, step: number): Promise<void> {
    try {
      const status = await this.provider.describe(workflowId);
      if (this.stopped) return;
      if (status.state === JOB_STATE.RUNNING) return this.schedule(workflowId, workflowType, step + 1);
      this.following.delete(workflowId);
      if (status.state === JOB_STATE.UNKNOWN) return;
      await publishWorkflowEvent({
        type: status.state === JOB_STATE.COMPLETED ? 'workflow.completed' : 'workflow.failed',
        source: FOLLOW_SOURCE,
        workflowId,
        workflowName: status.workflowType ?? workflowType,
        taskQueue: '',
        status: status.state,
      });
    } catch (err) {
      if (this.stopped) return;
      loggerRegistry.warn(DURABLE_LOG.FOLLOW_FAILED, { workflowId, error: err instanceof Error ? err.message : String(err) });
      this.schedule(workflowId, workflowType, step + 1);
    }
  }
}
