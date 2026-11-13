import {
  DELIVERY_RESULT,
  JOB_STATE,
  type LTDeliveryResult,
  type LTDurableProvider,
  type LTJobState,
  type LTWaitOutcome,
  type LTWaitRef,
  type LTJobStatus,
  type LTWorkflowExecution,
  type LTWorkflowListQuery,
  type LTWorkflowPage,
  type LTWorkflowStartInput,
} from '../../types/durable-provider';

export interface FakeDelivery {
  ref: LTWaitRef;
  outcome: LTWaitOutcome;
}

/**
 * In-memory durable provider for tests. Records every delivery; per-workflow
 * state and failures are set by the test.
 */
export class FakeDurableProvider implements LTDurableProvider {
  readonly name: string;
  readonly capabilities = { native: false, execution: true, terminate: true, list: true, start: true };
  readonly deliveries: FakeDelivery[] = [];
  readonly terminated: string[] = [];
  readonly listQueries: LTWorkflowListQuery[] = [];
  readonly started: LTWorkflowStartInput[] = [];
  result: unknown = undefined;
  listed: LTJobStatus[] = [];
  private states = new Map<string, LTJobState>();
  private failures = new Map<string, number>();
  private goneWorkflows = new Set<string>();

  constructor(name = 'fake') {
    this.name = name;
  }

  setState(workflowId: string, state: LTJobState): void {
    this.states.set(workflowId, state);
  }

  /** The next `times` deliveries to `workflowId` throw. */
  failNext(workflowId: string, times = 1): void {
    this.failures.set(workflowId, times);
  }

  markGone(workflowId: string): void {
    this.goneWorkflows.add(workflowId);
  }

  async deliver(ref: LTWaitRef, outcome: LTWaitOutcome): Promise<LTDeliveryResult> {
    const remaining = this.failures.get(ref.workflowId) ?? 0;
    if (remaining > 0) {
      this.failures.set(ref.workflowId, remaining - 1);
      throw new Error('engine unavailable');
    }
    if (this.goneWorkflows.has(ref.workflowId)) return DELIVERY_RESULT.GONE;
    this.deliveries.push({ ref, outcome });
    return DELIVERY_RESULT.DELIVERED;
  }

  async describe(workflowId: string) {
    return {
      workflowId,
      state: this.states.get(workflowId) ?? JOB_STATE.RUNNING,
      providerState: 'FAKE',
    };
  }

  async export(workflowId: string): Promise<LTWorkflowExecution> {
    return {
      workflow_id: workflowId,
      workflow_type: 'fakeWorkflow',
      task_queue: '',
      status: 'running',
      result: this.result,
      start_time: null,
      close_time: null,
      duration_ms: null,
      events: [],
      summary: {
        total_events: 0,
        activities: { total: 0, completed: 0, failed: 0, system: 0, user: 0 },
        child_workflows: { total: 0, completed: 0, failed: 0 },
        timers: 0,
        signals: 0,
      },
    };
  }

  /** Returns `listed` paged by the query; filtering is the engine's job, so the fake only records it. */
  async list(query: LTWorkflowListQuery): Promise<LTWorkflowPage> {
    this.listQueries.push(query);
    return { workflows: this.listed.slice(query.offset, query.offset + query.limit), total: this.listed.length };
  }

  async terminate(workflowId: string): Promise<void> {
    this.terminated.push(workflowId);
    this.states.set(workflowId, JOB_STATE.TERMINATED);
  }

  async start(input: LTWorkflowStartInput): Promise<void> {
    this.started.push(input);
    this.states.set(input.workflowId, JOB_STATE.RUNNING);
  }
}
