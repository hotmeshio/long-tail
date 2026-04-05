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
 * Claim an escalation to a specific user. Used for auto-assignment
 * when the system creates an advisory escalation (e.g., rounds exhausted).
 */
export async function ltClaimEscalation(input: {
  escalationId: string;
  userId: string;
  durationMinutes: number;
}): Promise<void> {
  const result = await escalationService.claimEscalation(
    input.escalationId,
    input.userId,
    input.durationMinutes,
  );
  if (!result) {
    loggerRegistry.warn(`[ltClaimEscalation] Escalation ${input.escalationId} could not be claimed`);
  }
}

/**
 * Enrich an escalation record with signal routing metadata and workflow
 * context so the resolution API can signal the paused workflow directly
 * and the dashboard can display full context. Optionally auto-claims
 * the escalation to the initiating user.
 */
export async function ltEnrichEscalationRouting(input: {
  escalationId: string;
  signalRouting: {
    taskQueue: string;
    workflowType: string;
    workflowId: string;
    signalId: string;
  };
  taskId?: string;
  claimForUserId?: string;
}): Promise<void> {
  const result = await escalationService.enrichEscalationRouting(
    input.escalationId,
    { signal_routing: { ...input.signalRouting, engine: 'durable' } },
    {
      workflowType: input.signalRouting.workflowType,
      workflowId: input.signalRouting.workflowId,
      taskQueue: input.signalRouting.taskQueue,
      taskId: input.taskId,
    },
  );
  if (!result) {
    loggerRegistry.warn(`[ltEnrichEscalationRouting] Escalation ${input.escalationId} not found`);
    return;
  }

  // Auto-claim to the initiating user with a long window (4 hours)
  if (input.claimForUserId) {
    await escalationService.claimEscalation(
      input.escalationId,
      input.claimForUserId,
      240,
    );
  }
}

/**
 * Create an escalation record when a workflow needs human intervention.
 */
export async function ltCreateEscalation(input: {
  type: string;
  subtype: string;
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
