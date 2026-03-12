import * as escalationService from '../../escalation';
import { loggerRegistry } from '../../logger';

/**
 * Resolve an escalation record. Called by the interceptor after
 * detecting a re-run (resolver data present in the envelope).
 * This makes resolution durable: if the server crashes after
 * signaling but before DB update, the workflow replays and
 * retries this activity.
 */
export async function ltResolveEscalation(input: {
  escalationId: string;
  resolverPayload: Record<string, any>;
}): Promise<void> {
  const result = await escalationService.resolveEscalation(
    input.escalationId,
    input.resolverPayload,
  );
  if (!result) {
    loggerRegistry.warn(`[ltResolveEscalation] Escalation ${input.escalationId} already resolved or not found`);
  }
}

/**
 * Create an escalation record when a workflow needs human intervention.
 */
export async function ltCreateEscalation(input: {
  type: string;
  subtype: string;
  modality: string;
  description?: string;
  priority?: number;
  taskId?: string;
  originId?: string;
  parentId?: string;
  role: string;
  envelope: string;
  metadata?: Record<string, any>;
  escalationPayload?: string;
  workflowId?: string;
  taskQueue?: string;
  workflowType?: string;
  traceId?: string;
  spanId?: string;
}): Promise<string> {
  const escalation = await escalationService.createEscalation({
    type: input.type,
    subtype: input.subtype,
    modality: input.modality,
    description: input.description,
    priority: input.priority,
    task_id: input.taskId,
    origin_id: input.originId,
    parent_id: input.parentId,
    role: input.role,
    envelope: input.envelope,
    metadata: input.metadata,
    escalation_payload: input.escalationPayload,
    workflow_id: input.workflowId,
    task_queue: input.taskQueue,
    workflow_type: input.workflowType,
    trace_id: input.traceId,
    span_id: input.spanId,
  });
  return escalation.id;
}
