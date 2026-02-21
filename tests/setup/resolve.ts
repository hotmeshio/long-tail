import { Client as Postgres } from 'pg';
import { MemFlow } from '@hotmeshio/hotmesh';

import { postgres_options } from './index';
import * as escalationService from '../../services/escalation';
import * as taskService from '../../services/task';

/**
 * Resolve a pending escalation by starting a new workflow with resolver data.
 * This mirrors what the POST /api/escalations/:id/resolve route does.
 *
 * Returns the new workflow ID so tests can wait for it.
 */
export async function resolveEscalation(
  escalationId: string,
  resolverPayload: Record<string, any>,
): Promise<string> {
  const escalation = await escalationService.getEscalation(escalationId);
  if (!escalation) throw new Error(`Escalation ${escalationId} not found`);
  if (escalation.status !== 'pending') {
    throw new Error(`Escalation ${escalationId} is ${escalation.status}, not pending`);
  }

  // Reconstruct envelope from escalation or task
  let envelope: Record<string, any> = {};
  if (escalation.envelope) {
    try { envelope = JSON.parse(escalation.envelope); } catch { /* use empty */ }
  } else if (escalation.task_id) {
    const task = await taskService.getTask(escalation.task_id);
    if (task?.envelope) {
      try { envelope = JSON.parse(task.envelope); } catch { /* use empty */ }
    }
  }

  // Inject resolver data and escalation ID
  envelope.resolver = resolverPayload;
  envelope.lt = { ...envelope.lt, escalationId: escalation.id };

  // Start a new workflow
  const newWorkflowId = `rerun-${escalation.id}-${Date.now()}`;
  const client = new MemFlow.Client({
    connection: { class: Postgres, options: postgres_options },
  });

  await client.workflow.start({
    workflowName: escalation.workflow_type!,
    args: [envelope],
    taskQueue: escalation.task_queue!,
    workflowId: newWorkflowId,
    expire: 180,
  });

  return newWorkflowId;
}
