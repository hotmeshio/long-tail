/**
 * LineWorkflows in memory: records each start, and finds a second start of
 * the same workflow id, as HotMesh does.
 */

import { START_OUTCOME, type LineWorkflows, type StartOutcome } from '../gateway/workflows';

export interface FakeStart {
  type: string;
  workflowId: string;
  data: Record<string, unknown>;
}

export class FakeLineWorkflows implements LineWorkflows {
  /** Every start that began a workflow, in order. */
  readonly started: FakeStart[] = [];
  /** Starts of an id already started. */
  repeats = 0;
  /** Thrown by the next start, then cleared. */
  failNext?: Error;

  async start(type: string, workflowId: string, data: Record<string, unknown>): Promise<StartOutcome> {
    const fail = this.failNext;
    this.failNext = undefined;
    if (fail) throw fail;
    if (this.started.some((s) => s.workflowId === workflowId)) {
      this.repeats++;
      return START_OUTCOME.ALREADY;
    }
    this.started.push({ type, workflowId, data });
    return START_OUTCOME.STARTED;
  }
}
