import type { LTMilestone } from './task';

/**
 * Payload published through the events system.
 */
export interface LTEvent {
  /** Event classification: 'milestone', 'escalation', 'task.completed', etc. */
  type: string;
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
  /** The activity name (present when source is 'activity') */
  activityName?: string;
  /** Milestones reported by the workflow */
  milestones: LTMilestone[];
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
}
