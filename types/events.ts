import type { LTMilestone } from './task';

/**
 * System event type patterns.
 *
 * System events use structured subjects with embedded resource IDs:
 *   `system.workflow.{workflowId}.completed`
 *   `system.escalation.{escalationId}.claimed`
 *   `system.activity.{workflowId}.{activityName}.failed`
 *
 * On the wire (NATS): `lt.events.system.workflow.abc123.completed`
 * Dashboard subscribes: `lt.events.system.>` for all system events,
 * or `lt.events.system.workflow.abc123.>` for a specific workflow.
 *
 * The `*` segments in these patterns are replaced with actual IDs at publish time.
 */
export type LTSystemEventPattern =
  | `system.task.${string}.created`
  | `system.task.${string}.started`
  | `system.task.${string}.completed`
  | `system.task.${string}.escalated`
  | `system.task.${string}.failed`
  | `system.escalation.${string}.created`
  | `system.escalation.${string}.resolved`
  | `system.escalation.${string}.claimed`
  | `system.escalation.${string}.released`
  | `system.workflow.${string}.started`
  | `system.workflow.${string}.completed`
  | `system.workflow.${string}.failed`
  | `system.activity.${string}.${string}.started`
  | `system.activity.${string}.${string}.completed`
  | `system.activity.${string}.${string}.failed`
  | `system.knowledge.${string}.stored`
  | `system.knowledge.${string}.deleted`
  | 'system.file.stored'
  | 'system.file.deleted'
  | `system.agent.${string}.started`
  | `system.agent.${string}.completed`
  | `system.agent.${string}.failed`
  | `system.agent.${string}.status_changed`
  | `system.agent.${string}.triggers_changed`
  | `system.milestone.${string}`;

/** @deprecated Use LTSystemEventPattern for system events. Kept for backward compat. */
export type LTEventType = LTSystemEventPattern;

/**
 * Application-defined event type.
 * Convention: `app.{namespace}.{entity}.{action}`
 * Examples: `app.epic.apis.createorder.error`, `app.vendor.schema.drift`
 */
export type LTAppEventType = `app.${string}`;

/**
 * The minimal universal envelope every event carries — system OR custom.
 *
 * Only `type` and `timestamp` are required. `id` is minted by
 * `eventRegistry.publish()` when omitted (custom publishers may supply their
 * own). Everything beyond this base is a per-family extension — see the
 * `LT*Event` interfaces below — added only by the families that need it. A
 * custom app event (e.g. `app.image.resized`) is just this base plus `data`;
 * no workflow fields are injected.
 */
export interface LTEventBase {
  /** Idempotent event identifier. Minted by eventRegistry.publish() if omitted. */
  id?: string;
  /** Subject — structured for system events, free-form `app.*` for custom events. */
  type: LTSystemEventPattern | LTAppEventType | string;
  /** ISO 8601 timestamp. Set by the publisher; eventRegistry ensures it is present. */
  timestamp: string;
  /** Producer tag (e.g. 'interceptor', 'agent', 'dashboard'). Optional. */
  source?: string;
  /** Event payload — topic-specific shape. For custom events this is the whole story. */
  data?: Record<string, any>;
}

/**
 * Broad, consumer-facing event type: the minimal envelope plus every system
 * extension field as OPTIONAL. Adapters and generic consumers (the agent trigger
 * registry, input_mapper, dashboards) type against this — they cannot assume any
 * extension is present. Producers construct one of the precise `LT*Event` family
 * types below (which narrow the relevant fields to required); each is assignable
 * to this type.
 */
export interface LTEvent extends LTEventBase {
  /** Workflow instance — present on workflow/task/escalation/activity events. */
  workflowId?: string;
  /** Workflow function name — present on the same families. */
  workflowName?: string;
  /** Task queue — present on the same families. */
  taskQueue?: string;
  /** Task ID — present when orchestrated. */
  taskId?: string;
  /** Escalation ID — present on escalation events. */
  escalationId?: string;
  /** Root process lineage — present on workflow/task/escalation events. */
  originId?: string;
  /** Lifecycle status. Vocabulary is per-family (see the family interfaces). */
  status?: string;
  /** Activity step name — present on activity events. */
  activityName?: string;
  /** Milestones — present on milestone/task events. */
  milestones?: LTMilestone[];
}

// ── Per-family event extensions ("the system injects fields by type") ─────────
// Each family extends the minimal base with the fields it actually populates.
// lib/events/publish.ts constructs these; all are assignable to the broad
// LTEvent above. This is the discriminated layer: which fields exist is a
// function of the subject family, not a universal requirement.

/** Workflow context shared by the workflow-bearing families. */
export interface LTWorkflowContext {
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  originId?: string;
  taskId?: string;
}

/** `system.workflow.{workflowId}.{started|completed|failed}`. status ∈ started|in_progress|running|completed|failed. */
export interface LTWorkflowEvent extends LTEventBase, LTWorkflowContext {
  status: string;
  milestones?: LTMilestone[];
}

/** `system.task.{taskId}.{created|started|completed|escalated|failed}`. status ∈ created|in_progress|completed|needs_intervention|failed. */
export interface LTTaskEvent extends LTEventBase, LTWorkflowContext {
  taskId: string;
  status: string;
  milestones?: LTMilestone[];
}

/** `system.escalation.{escalationId}.{created|resolved|claimed|released}`. status ∈ pending|claimed|released|resolved|cancelled. */
export interface LTEscalationEvent extends LTEventBase, LTWorkflowContext {
  escalationId: string;
  status: string;
}

/** `system.activity.{workflowId}.{activityName}.{started|completed|failed}`. */
export interface LTActivityEvent extends LTEventBase, LTWorkflowContext {
  activityName: string;
}

/** `system.milestone.{workflowId}`. */
export interface LTMilestoneEvent extends LTEventBase, LTWorkflowContext {
  milestones: LTMilestone[];
  activityName?: string;
}

/** `system.agent.{agentName}.{started|completed|failed|status_changed|triggers_changed}`. */
export interface LTAgentEvent extends LTEventBase {
  /** Agent id (carried in workflowId for routing parity). */
  workflowId?: string;
  /** Agent name (carried in workflowName). */
  workflowName?: string;
  status?: string;
}

/**
 * `system.knowledge.{domain}.{stored|deleted}`, `system.file.{stored|deleted}`,
 * and any custom `app.*` event — no workflow context, everything lives in `data`.
 */
export type LTDataEvent = LTEventBase;

/**
 * Precise union of system event families. Produce these; consume via `LTEvent`.
 */
export type LTSystemEvent =
  | LTWorkflowEvent
  | LTTaskEvent
  | LTEscalationEvent
  | LTActivityEvent
  | LTMilestoneEvent
  | LTAgentEvent
  | LTDataEvent;

/**
 * Pluggable event adapter interface.
 *
 * Implement this to route Long Tail events to your pub/sub system
 * (NATS, SNS, GCP Pub/Sub, Kafka, etc.).
 *
 * Usage:
 * ```typescript
 * import { LTEventAdapter, LTEvent } from '@hotmeshio/long-tail';
 *
 * class MySnsAdapter implements LTEventAdapter {
 *   async connect() { /* init SNS client *​/ }
 *   async publish(event: LTEvent) { /* publish to SNS *​/ }
 *   async disconnect() { /* cleanup *​/ }
 * }
 * ```
 */
export interface LTEventAdapter {
  /** Initialize the connection (called once during startup) */
  connect(): Promise<void>;
  /** Publish an event (fire-and-forget semantics; errors are swallowed by the registry) */
  publish(event: LTEvent): Promise<void>;
  /** Graceful shutdown */
  disconnect(): Promise<void>;
  /**
   * Bridge cross-container events to the in-process callback adapter.
   *
   * Implemented by transport adapters that support cross-process delivery
   * (NATS, SNS, GCP Pub/Sub, Kafka, etc.). When set, the adapter subscribes
   * to all events on the bus and forwards events from other containers to
   * the local callback adapter for agent trigger dispatch.
   *
   * The adapter must de-duplicate its own events (e.g., via an origin ID)
   * to prevent the publishing container from re-processing its own events.
   */
  setCallbackBridge?(adapter: LTEventAdapter): void;
}
