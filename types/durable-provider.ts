/**
 * Durable provider contract.
 *
 * Long Tail owns the escalation boundary; a durable engine owns time and
 * causality. A workflow running on any engine opens a wait (an escalation
 * row) and receives exactly one terminal outcome. The provider is the
 * engine side of that contract: it delivers the outcome, reports workflow
 * status and, when it can, exports the execution timeline.
 */

/** Built-in provider names. Third-party providers choose their own. */
export const DURABLE_PROVIDER = {
  HOTMESH: 'hotmesh',
  TEMPORAL: 'temporal',
  DBOS: 'dbos',
} as const;

/** Terminal outcome statuses delivered to a waiting workflow. */
export const WAIT_OUTCOME_STATUS = {
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const;

export type LTWaitOutcomeStatus = typeof WAIT_OUTCOME_STATUS[keyof typeof WAIT_OUTCOME_STATUS];

/** Result of one delivery attempt. `gone` means the waiter no longer exists. */
export const DELIVERY_RESULT = {
  DELIVERED: 'delivered',
  GONE: 'gone',
} as const;

export type LTDeliveryResult = typeof DELIVERY_RESULT[keyof typeof DELIVERY_RESULT];

/** Identifies one wait inside one workflow on one engine. */
export interface LTWaitRef {
  provider: string;
  workflowId: string;
  /** Engine run scope (Temporal runId); empty when the engine has none. */
  runScope: string;
  waitKey: string;
}

/** The single message a waiting workflow receives. */
export interface LTWaitOutcome {
  waitKey: string;
  escalationId: string;
  status: LTWaitOutcomeStatus;
  /** The resolver payload when resolved; on expiry, the collection an accumulator or `partialOnTimeout` batch kept. */
  data?: Record<string, unknown>;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface LTDurableCapabilities {
  /** True only for HotMesh: enables every HotMesh-specific surface. */
  native: boolean;
  /** `export()` is available. */
  execution: boolean;
  /** `terminate()` is available. */
  terminate: boolean;
  /** `list()` is available. */
  list: boolean;
  /** `start()` is available: Long Tail can invoke and schedule workflows. */
  start?: boolean;
}

export const JOB_STATE = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TERMINATED: 'terminated',
  UNKNOWN: 'unknown',
} as const;

export type LTJobState = typeof JOB_STATE[keyof typeof JOB_STATE];

export interface LTJobStatus {
  workflowId: string;
  workflowType?: string;
  state: LTJobState;
  /** The engine's own status name. */
  providerState: string;
  startedAt?: string;
  closedAt?: string;
}

// ── Listing workflows ────────────────────────────────────────────────────────

/** States the executions list filters on. Failed covers every unsuccessful close. */
export const WORKFLOW_LIST_STATE = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type LTWorkflowListState = typeof WORKFLOW_LIST_STATE[keyof typeof WORKFLOW_LIST_STATE];

export interface LTWorkflowListQuery {
  limit: number;
  offset: number;
  workflowType?: string;
  /** Matches workflow ids that start with this value. */
  idPrefix?: string;
  state?: LTWorkflowListState;
}

/** One page of workflows in the engine's order, newest first where the engine allows. */
export interface LTWorkflowPage {
  workflows: LTJobStatus[];
  /** Every workflow matching the query, across pages. */
  total: number;
}

// ── Execution timeline ───────────────────────────────────────────────────────

export type LTExecutionEventCategory = 'workflow' | 'activity' | 'child_workflow' | 'timer' | 'signal';

export interface LTWorkflowExecutionEvent {
  event_id: number;
  event_type: string;
  category: LTExecutionEventCategory;
  event_time: string;
  duration_ms: number | null;
  is_system: boolean;
  attributes: { kind: string; timeline_key?: string; [key: string]: unknown };
}

export interface LTWorkflowExecutionSummary {
  total_events: number;
  activities: { total: number; completed: number; failed: number; system: number; user: number };
  child_workflows: { total: number; completed: number; failed: number };
  timers: number;
  signals: number;
}

/** The execution timeline every provider produces; the dashboard renders this shape. */
export interface LTWorkflowExecution {
  workflow_id: string;
  workflow_type: string;
  workflow_name?: string;
  task_queue: string;
  status: 'running' | 'completed' | 'failed';
  /** The engine's own status name when it is richer than `status`. */
  provider_status?: string;
  start_time: string | null;
  close_time: string | null;
  duration_ms: number | null;
  trace_id?: string;
  parent_workflow_id?: string;
  result?: unknown;
  events: LTWorkflowExecutionEvent[];
  summary: LTWorkflowExecutionSummary;
}

export interface LTExecutionExportOptions {
  excludeSystem?: boolean;
  omitResults?: boolean;
  mode?: 'sparse' | 'verbose';
  maxDepth?: number;
}

// ── Start a workflow ─────────────────────────────────────────────────────────

/** A workflow Long Tail asks the engine to start, from an invoke or a schedule. */
export interface LTWorkflowStartInput {
  workflowType: string;
  workflowId: string;
  /** The workflow config's `task_queue`: the engine's task queue or queue name. */
  taskQueue: string;
  /** One argument, the envelope `{ data, metadata, lt }`, as on HotMesh. */
  args: unknown[];
}

// ── Provider ─────────────────────────────────────────────────────────────────

export interface LTDurableProvider {
  readonly name: string;
  readonly capabilities: LTDurableCapabilities;
  /** Deliver the terminal outcome. Returns `gone` when the waiter no longer exists; throws on transient failure. */
  deliver(ref: LTWaitRef, outcome: LTWaitOutcome): Promise<LTDeliveryResult>;
  describe(workflowId: string): Promise<LTJobStatus>;
  export?(workflowId: string, options?: LTExecutionExportOptions): Promise<LTWorkflowExecution>;
  terminate?(workflowId: string, reason: string): Promise<void>;
  list?(query: LTWorkflowListQuery): Promise<LTWorkflowPage>;
  /** Start a workflow. Throws when the engine refuses it, such as a duplicate id. */
  start?(input: LTWorkflowStartInput): Promise<void>;
}

export interface LTDurableRelayConfig {
  /** Recovery sweep interval. Default 30 s. */
  sweepMs?: number;
  /** Delivery lease per wait. Default 30 s. */
  leaseMs?: number;
  /** Waits claimed per pass. Default 50. */
  batch?: number;
  /** Interval for closing escalations whose workflow has ended. Default 15 min. 0 disables. */
  reconcileMs?: number;
}

export interface LTDurableConfig {
  /** The engine running customer workflows. Omit for HotMesh. */
  provider?: LTDurableProvider;
  /** Link to the engine's console for one workflow; `{workflowId}` is the placeholder. */
  consoleUrl?: string;
  relay?: LTDurableRelayConfig;
}

// ── Open a wait ──────────────────────────────────────────────────────────────

/** Body of `POST /api/escalations/waits`. */
export interface LTOpenWaitInput {
  workflowId: string;
  runScope?: string;
  workflowType?: string;
  waitKey: string;
  role: string;
  type: string;
  subtype?: string;
  description?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
  /** Shown to the resolver; stored as the escalation payload. */
  data?: Record<string, unknown>;
  /** ISO time when Long Tail expires the escalation. */
  expiresAt?: string;
  /** Item keys the wait collects, one fill each. The last fill resolves it with every item. */
  batch?: string[];
  /** Batch only: on expiry, deliver the items filled so far. */
  partialOnTimeout?: boolean;
  /** Batch only: a flagged item ends the wait. */
  wakeOnFlag?: boolean;
  /** Batch only: a fill ends the wait with the items so far, for every key (`true`) or the listed keys. */
  wakeOnFill?: boolean | string[];
  /** Batch only: items already satisfied when the wait opens. */
  filled?: Record<string, LTWaitFilledEntry>;
  /** Collect items until `max`, the deadline or a resolve; the outcome carries `$accumulated` and `$trigger`. */
  accumulate?: LTWaitAccumulateConfig;
}

/** A batch item satisfied before the wait opens. */
export interface LTWaitFilledEntry {
  payload: Record<string, unknown>;
  /** ISO time the item was satisfied, from the source of record. */
  at: string;
  actor?: string;
}

export interface LTWaitAccumulateConfig {
  /** Count that ends the wait. Absent: only the deadline or a resolve ends it. */
  max?: number;
  /** Default true. False makes `max` a cap: further adds answer `full`. */
  resolveAtMax?: boolean;
  /** Default true. False replaces a repeated item key in place. */
  unique?: boolean;
}

export interface LTOpenWaitResult {
  escalationId: string;
  status: string;
  created: boolean;
}
