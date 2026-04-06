import { Router } from 'express';

import * as escalationService from '../../services/escalation';
import * as taskService from '../../services/task';
import { escalationStrategyRegistry } from '../../services/escalation-strategy';
import { publishEscalationEvent } from '../../services/events/publish';
import { storeEphemeral, formatEphemeralToken } from '../../services/iam/ephemeral';
import { getEngine as getYamlEngine } from '../../services/yaml-workflow/deployer';
import { createClient } from '../../workers';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';

export function registerResolveRoutes(router: Router): void {
  /**
   * POST /api/escalations/:id/resolve
   * Start a new workflow with resolver data to re-run the failed step.
   * The interceptor in the new workflow resolves the escalation record
   * and signals back to the orchestrator (if any) on success.
   * Body: { resolverPayload: Record<string, any> }
   */
  router.post('/:id/resolve', async (req, res) => {
    try {
      const { resolverPayload } = req.body || {};
      if (!resolverPayload) {
        res.status(400).json({ error: 'resolverPayload is required' });
        return;
      }

      // 1. Read escalation (verify pending)
      const escalation = await escalationService.getEscalation(req.params.id);
      if (!escalation) {
        res.status(404).json({ error: 'Escalation not found' });
        return;
      }
      if (escalation.status !== 'pending') {
        res.status(409).json({ error: 'Escalation not available for resolution' });
        return;
      }

      // 2. waitFor signal escalation -- signal the paused workflow directly
      const signalRouting = (escalation.metadata as any)?.signal_routing;
      if (signalRouting?.signalId) {
        // Replace password fields with ephemeral tokens so plaintext never enters the signal store
        let signalPayload = resolverPayload;
        const formSchema = (escalation.metadata as any)?.form_schema;
        if (formSchema?.properties) {
          signalPayload = { ...resolverPayload };
          for (const [key, def] of Object.entries(formSchema.properties)) {
            if ((def as any)?.format === 'password' && typeof signalPayload[key] === 'string') {
              const uuid = await storeEphemeral(signalPayload[key], {
                ttlSeconds: 900,
                label: key,
              });
              signalPayload[key] = formatEphemeralToken(uuid, key);
            }
          }
        }

        if (signalRouting.engine === 'yaml' && signalRouting.hookTopic && signalRouting.appId) {
          // YAML workflow: signal the HotMesh engine directly via hook topic.
          // Include job_id for hook match condition ({$job.metadata.jid} === {$self.hook.data.job_id}).
          const engine = await getYamlEngine(signalRouting.appId);
          await engine.signal(signalRouting.hookTopic, {
            ...signalPayload,
            escalationId: escalation.id,
            job_id: signalRouting.jobId,
          });
        } else if (signalRouting.workflowId) {
          // Durable workflow: signal via workflow handle
          const client = createClient();
          const handle = await client.workflow.getHandle(
            signalRouting.taskQueue,
            signalRouting.workflowType,
            signalRouting.workflowId,
          );
          await handle.signal(signalRouting.signalId, signalPayload);
        }

        await escalationService.resolveEscalation(escalation.id, resolverPayload);

        publishEscalationEvent({
          type: 'escalation.resolved',
          source: 'api',
          workflowId: escalation.workflow_id || signalRouting.workflowId,
          workflowName: escalation.workflow_type || signalRouting.workflowType,
          taskQueue: escalation.task_queue || signalRouting.taskQueue || signalRouting.appId,
          taskId: escalation.task_id!,
          escalationId: escalation.id,
          originId: escalation.origin_id ?? undefined,
          status: 'resolved',
        });

        res.json({ signaled: true, escalationId: escalation.id, workflowId: signalRouting.workflowId || signalRouting.appId });
        return;
      }

      // 3. Reconstruct the original envelope from the escalation or task
      let envelope: Record<string, any> = {};
      if (escalation.envelope) {
        try {
          envelope = JSON.parse(escalation.envelope);
        } catch { /* use empty */ }
      } else if (escalation.task_id) {
        const task = await taskService.getTask(escalation.task_id);
        if (task?.envelope) {
          try {
            envelope = JSON.parse(task.envelope);
          } catch { /* use empty */ }
        }
      }

      // 4. Check escalation strategy for triage routing
      const strategy = escalationStrategyRegistry.current;
      if (strategy) {
        const directive = await strategy.onResolution({
          escalation,
          resolverPayload,
          envelope,
        });

        if (directive.action === 'triage') {
          // Route to MCP triage orchestrator instead of standard re-run
          const originalTask = escalation.task_id
            ? await taskService.getTask(escalation.task_id)
            : null;
          const routing = originalTask?.metadata as Record<string, any> | null;

          const triageWorkflowId = `triage-${escalation.id}-${Date.now()}`;
          const client = createClient();

          // Triage lives on a separate axis -- do NOT copy the original
          // task's parent routing (signalId, parentWorkflowId) into the
          // triage task. Otherwise the container interceptor would signal
          // the original parent when triage completes, prematurely closing
          // the original workflow. Triage exits the vortex by creating a
          // targeted escalation on the original task instead.
          await taskService.createTask({
            workflow_id: triageWorkflowId,
            workflow_type: 'mcpTriageRouter',
            lt_type: 'mcpTriage',
            task_queue: 'long-tail-system',
            signal_id: `lt-triage-${triageWorkflowId}`,
            parent_workflow_id: triageWorkflowId,
            origin_id: escalation.origin_id || triageWorkflowId,
            parent_id: escalation.parent_id ?? undefined,
            envelope: JSON.stringify(directive.triageEnvelope),
          });

          await client.workflow.start({
            workflowName: 'mcpTriageRouter',
            args: [directive.triageEnvelope],
            taskQueue: 'long-tail-system',
            workflowId: triageWorkflowId,
            expire: JOB_EXPIRE_SECS,
            entity: 'mcpTriageRouter',
          } as any);

          // Mark escalation as resolved (triage is handling it)
          await escalationService.resolveEscalation(escalation.id, {
            ...resolverPayload,
            _lt: { ...resolverPayload._lt, triaged: true, triageWorkflowId },
          });

          publishEscalationEvent({
            type: 'escalation.resolved',
            source: 'api',
            workflowId: escalation.workflow_id!,
            workflowName: escalation.workflow_type!,
            taskQueue: escalation.task_queue!,
            taskId: escalation.task_id!,
            escalationId: escalation.id,
            originId: escalation.origin_id ?? undefined,
            status: 'resolved',
          });

          res.json({
            started: true,
            escalationId: escalation.id,
            workflowId: triageWorkflowId,
            triage: true,
          });
          return;
        }
      }

      // 5. If no workflow_type, this is a notification-only escalation -- acknowledge and close
      if (!escalation.workflow_type || !escalation.task_queue) {
        await escalationService.resolveEscalation(escalation.id, resolverPayload);
        res.json({ acknowledged: true, escalationId: escalation.id });
        return;
      }

      // 6. Standard re-run: inject resolver data and start original workflow
      envelope.resolver = resolverPayload;
      envelope.lt = {
        ...envelope.lt,
        escalationId: escalation.id,
      };

      const newWorkflowId = `rerun-${escalation.id}-${Date.now()}`;
      const client = createClient();

      await client.workflow.start({
        workflowName: escalation.workflow_type,
        args: [envelope],
        taskQueue: escalation.task_queue,
        workflowId: newWorkflowId,
        expire: 180,
      });

      publishEscalationEvent({
        type: 'escalation.resolved',
        source: 'api',
        workflowId: escalation.workflow_id!,
        workflowName: escalation.workflow_type!,
        taskQueue: escalation.task_queue!,
        taskId: escalation.task_id!,
        escalationId: escalation.id,
        originId: escalation.origin_id ?? undefined,
        status: 'resolved',
      });

      res.json({ started: true, escalationId: escalation.id, workflowId: newWorkflowId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
