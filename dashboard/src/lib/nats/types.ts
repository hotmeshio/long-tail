/**
 * Event payload — mirrors the server-side LTEvent interface.
 *
 * Topic space: `lt.events.{type}` (e.g. `lt.events.task.completed`)
 * Dashboard subscribes to `lt.events.>` to receive all events.
 */
export interface NatsLTEvent {
  id?: string;
  type: NatsLTEventType | string;
  source: string;
  workflowId: string;
  workflowName: string;
  taskQueue: string;
  taskId?: string;
  escalationId?: string;
  originId?: string;
  status?: string;
  activityName?: string;
  milestones?: Array<{ name: string; value: unknown }>;
  data?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Known event types published by the Long Tail server.
 */
export type NatsLTEventType =
  | `system.task.${string}.${string}`
  | `system.escalation.${string}.${string}`
  | `system.workflow.${string}.${string}`
  | `system.activity.${string}.${string}.${string}`
  | `system.knowledge.${string}.${string}`
  | `system.file.${string}`
  | `system.agent.${string}.${string}`
  | `system.milestone.${string}`;

/**
 * Event type category prefixes for pattern matching.
 */
export type NatsLTEventCategory = 'task' | 'escalation' | 'workflow' | 'activity' | 'knowledge' | 'agent' | 'milestone';

/**
 * Callback signature for event subscribers.
 */
export type NatsEventHandler = (event: NatsLTEvent) => void;
