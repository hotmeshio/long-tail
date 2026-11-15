import { loggerRegistry } from '../../lib/logger';
import { publishWorkflowEvent } from '../../lib/events/publish';
import { JOB_STATE, type LTDurableProvider, type LTJobStatus } from '../../types/durable-provider';
import { DURABLE_LOG, FOLLOW_DEFAULTS } from './constants';
import { claimDueFollows, recordFollow, removeFollow } from './follow-store';

const FOLLOW_SOURCE = 'durable-relay';

/**
 * Follows a workflow until the engine reports it closed, then publishes
 * `workflow.completed` or `workflow.failed`, the events HotMesh's interceptor
 * publishes, so pages showing the workflow refresh. Each follow is a stored
 * row, so it outlives this process; the caller that removes the row
 * publishes. A new follow is also watched in memory at short delays.
 */
export class WorkflowFollower {
  private readonly watching = new Map<string, NodeJS.Timeout>();
  private sweeping: Promise<number> | null = null;
  private stopped = false;

  constructor(
    private readonly provider: LTDurableProvider,
    private readonly delaysMs: readonly number[] = FOLLOW_DEFAULTS.DELAYS_MS,
    private readonly maxWatched: number = FOLLOW_DEFAULTS.MAX_FOLLOWED,
  ) {}

  /** Workflows watched in memory now. */
  get size(): number {
    return this.watching.size;
  }

  /** Store the follow, then watch it. */
  async follow(workflowId: string, workflowType: string): Promise<void> {
    await recordFollow(this.provider.name, workflowId, workflowType);
    this.watch(workflowId);
  }

  /** Check a stored follow at short delays; past the last one, the sweep carries on. */
  watch(workflowId: string): void {
    if (this.stopped || this.watching.has(workflowId)) return;
    if (this.watching.size >= this.maxWatched) {
      loggerRegistry.debug(DURABLE_LOG.FOLLOW_SKIPPED, { workflowId, watching: this.watching.size });
      return;
    }
    this.schedule(workflowId, 0);
  }

  /** Check every due stored follow once. Returns the completions published. */
  async sweep(): Promise<number> {
    if (this.stopped) return 0;
    if (this.sweeping) return this.sweeping;
    this.sweeping = this.checkDue();
    try {
      return await this.sweeping;
    } finally {
      this.sweeping = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.watching.values()) clearTimeout(timer);
    this.watching.clear();
    await this.sweeping?.catch(() => undefined);
  }

  private async checkDue(): Promise<number> {
    let published = 0;
    for (const { workflow_id: workflowId } of await claimDueFollows(this.provider.name)) {
      if (this.stopped) break;
      try {
        const status = await this.provider.describe(workflowId);
        if (status.state === JOB_STATE.RUNNING) continue;
        if (status.state === JOB_STATE.UNKNOWN) await removeFollow(this.provider.name, workflowId);
        else if (await this.publishClosed(workflowId, status)) published++;
      } catch (err) {
        loggerRegistry.warn(DURABLE_LOG.FOLLOW_FAILED, { workflowId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return published;
  }

  private schedule(workflowId: string, step: number): void {
    if (step >= this.delaysMs.length) {
      this.watching.delete(workflowId);
      return;
    }
    const timer = setTimeout(() => { void this.check(workflowId, step); }, this.delaysMs[step]);
    timer.unref?.();
    this.watching.set(workflowId, timer);
  }

  private async check(workflowId: string, step: number): Promise<void> {
    try {
      const status = await this.provider.describe(workflowId);
      if (this.stopped) return;
      if (status.state === JOB_STATE.RUNNING) return this.schedule(workflowId, step + 1);
      this.watching.delete(workflowId);
      if (status.state !== JOB_STATE.UNKNOWN) await this.publishClosed(workflowId, status);
    } catch (err) {
      if (this.stopped) return;
      loggerRegistry.warn(DURABLE_LOG.FOLLOW_FAILED, { workflowId, error: err instanceof Error ? err.message : String(err) });
      this.schedule(workflowId, step + 1);
    }
  }

  /** Publish the close when this call removed the follow. */
  private async publishClosed(workflowId: string, status: LTJobStatus): Promise<boolean> {
    const follow = await removeFollow(this.provider.name, workflowId);
    if (!follow) return false;
    await publishWorkflowEvent({
      type: status.state === JOB_STATE.COMPLETED ? 'workflow.completed' : 'workflow.failed',
      source: FOLLOW_SOURCE,
      workflowId,
      workflowName: status.workflowType ?? follow.workflow_type ?? '',
      taskQueue: '',
      status: status.state,
    });
    return true;
  }
}
