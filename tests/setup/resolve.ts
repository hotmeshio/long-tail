import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from './index';
import * as escalationService from '../../services/escalation';
import * as taskService from '../../services/task';
import { escalationStrategyRegistry } from '../../services/escalation-strategy';

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

  // Check escalation strategy for triage routing
  const strategy = escalationStrategyRegistry.current;
  if (strategy) {
    const directive = await strategy.onResolution({
      escalation,
      resolverPayload,
      envelope,
    });

    if (directive.action === 'triage') {
      const originalTask = escalation.task_id
        ? await taskService.getTask(escalation.task_id)
        : null;
      const routing = originalTask?.metadata as Record<string, any> | null;

      const triageWorkflowId = `triage-${escalation.id}-${Date.now()}`;
      const client = new Durable.Client({
        connection: { class: Postgres, options: postgres_options },
      });

      await taskService.createTask({
        workflow_id: triageWorkflowId,
        workflow_type: 'mcpTriage',
        lt_type: 'mcpTriage',
        task_queue: 'long-tail-system',
        signal_id: `lt-triage-${triageWorkflowId}`,
        parent_workflow_id: routing?.parentWorkflowId || triageWorkflowId,
        origin_id: escalation.origin_id || triageWorkflowId,
        parent_id: escalation.parent_id || undefined,
        envelope: JSON.stringify(directive.triageEnvelope),
        metadata: routing || undefined,
      });

      await client.workflow.start({
        workflowName: 'mcpTriage',
        args: [directive.triageEnvelope],
        taskQueue: 'long-tail-system',
        workflowId: triageWorkflowId,
        expire: 300,
        entity: 'mcpTriage',
      } as any);

      // Mark escalation as resolved (triage is handling it)
      await escalationService.resolveEscalation(escalation.id, {
        ...resolverPayload,
        _lt: { ...resolverPayload._lt, triaged: true, triageWorkflowId },
      });

      return triageWorkflowId;
    }
  }

  // Standard re-run: inject resolver data and start original workflow
  envelope.resolver = resolverPayload;
  envelope.lt = { ...envelope.lt, escalationId: escalation.id };

  const newWorkflowId = `rerun-${escalation.id}-${Date.now()}`;
  const client = new Durable.Client({
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
