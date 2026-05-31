import type { LTMilestone } from './task';

/**
 * All event types published through the NATS event system.
 *
 * Topic space: `lt.events.{type}` — e.g. `lt.events.task.created`
 *
 * Dashboard subscribes to `lt.events.>` to receive all events.
 */
export type LTEventType =
  | 'task.created'
  | 'task.started'
  | 'task.completed'
  | 'task.escalated'
  | 'task.failed'
  | 'escalation.created'
  | 'escalation.resolved'
  | 'escalation.claimed'
  | 'escalation.released'
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'activity.started'
  | 'activity.completed'
  | 'activity.failed'
  | 'knowledge.stored'
  | 'knowledge.deleted'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.status_changed'
  | 'milestone';

/**
 * Application-defined event type.
 * Convention: `app.{namespace}.{entity}.{action}`
 * Examples: `app.epic.apis.createorder.error`, `app.vendor.schema.drift`
 */
export type LTAppEventType = `app.${string}`;

/**
 * Payload published through the events system.
 */
export interface LTEvent {
  /** Event classification */
  type: LTEventType | string;
  /** Where the event originated: 'interceptor' | 'orchestrator' | 'activity' */
  source: string;
  /** The workflow instance that produced this event */
  workflowId: string;
  /** The workflow function name */
  workflowName: string;
  /** The task queue the workflow ran on */
  taskQueue: string;
  /** The task ID (present when orchestrated) */
  taskId?: string;
  /** The escalation ID (present for escalation events) */
  escalationId?: string;
  /** The origin ID — root process lineage */
  originId?: string;
  /** Task or workflow status after this event */
  status?: string;
  /** The activity name (present when source is 'activity') */
  activityName?: string;
  /** Milestones reported by the workflow */
  milestones?: LTMilestone[];
  /** Optional result data */
  data?: Record<string, any>;
  /** ISO 8601 timestamp */
  timestamp: string;
}

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
