import { MemFlow } from '@hotmeshio/hotmesh';

import * as interceptorActivities from './activities';

import type { LTReturn, LTEscalation, LTMilestone, LTResolvedConfig } from '../types';

type ActivitiesType = typeof interceptorActivities;

/**
 * The Long Tail interceptor wraps every registered workflow.
 *
 * Two-layer architecture:
 *
 * 1. **Orchestrated mode** — When a workflow is started via `executeLT()`,
 *    the task record already exists. The interceptor only handles escalation:
 *    creates an escalation record, pauses with `waitFor`, and resumes when
 *    a human resolves via the API.
 *
 * 2. **Standalone mode** — When a workflow is started directly (e.g., tests,
 *    simple usage without an orchestrator), the interceptor also creates and
 *    completes the task record for backward compatibility.
 *
 * Orchestrator workflows (name ending in "Orchestrator") pass through
 * without any interception — they call `executeLT` internally.
 */
export function createLTInterceptor(options: {
  activityTaskQueue: string;
  defaultRole?: string;
  defaultModality?: string;
}) {
  const {
    activityTaskQueue,
    defaultRole = 'reviewer',
    defaultModality = 'default',
  } = options;

  const interceptor = {
    async execute(
      ctx: Map<string, any>,
      next: () => Promise<any>,
    ): Promise<any> {
      const workflowId = ctx.get('workflowId') as string;
      const workflowName = ctx.get('workflowName') as string;
      const workflowTopic = ctx.get('workflowTopic') as string;

      const signalId = `lt-resolve-${workflowId}`;

      // Proxy the interceptor activities through the shared queue
      const {
        ltCreateTask,
        ltStartTask,
        ltCompleteTask,
        ltEscalateTask,
        ltFailTask,
        ltGetTaskByWorkflowId,
        ltCreateEscalation,
        ltResolveEscalation,
        ltGetWorkflowConfig,
      } = MemFlow.workflow.proxyActivities<ActivitiesType>({
        activities: interceptorActivities,
        taskQueue: activityTaskQueue,
        retryPolicy: { maximumAttempts: 3 },
      });

      // Load config for this workflow type
      const wfConfig = await ltGetWorkflowConfig(workflowName);

      // Pass through if: container, explicitly not-LT, or unregistered
      if (wfConfig?.isContainer || wfConfig?.isLT === false) {
        return next();
      }
      if (!wfConfig && workflowName?.endsWith('Orchestrator')) {
        return next(); // Legacy fallback for unregistered orchestrators
      }
      if (!wfConfig) {
        return next(); // Unregistered = generic, not intercepted
      }

      // Derive the task queue from workflowTopic (strip the workflowName suffix)
      const taskQueue = workflowTopic
        ? workflowTopic.replace(new RegExp(`-${workflowName}$`), '')
        : 'long-tail';

      try {
        // Execute the workflow
        const result = await next();

        // ── Escalation path ────────────────────────────────────────
        if (result?.type === 'escalation') {
          const escalationResult = result as LTEscalation;

          // Check if task already exists (orchestrated via executeLT)
          const existingTask = await ltGetTaskByWorkflowId(workflowId);
          const isOrchestrated = !!existingTask;
          let taskId = existingTask?.id;

          // Standalone mode: create task now
          if (!isOrchestrated) {
            taskId = await ltCreateTask({
              workflowId,
              workflowType: workflowName,
              ltType: workflowName,
              signalId,
              parentWorkflowId: workflowId,
              envelope: '{}',
            });
            await ltStartTask(taskId!);
          }

          // Mark task as needing intervention
          await ltEscalateTask(taskId!);

          // Create escalation record with workflow routing fields
          const escalationId = await ltCreateEscalation({
            type: workflowName,
            subtype: workflowName,
            modality: escalationResult.modality || wfConfig?.modality || defaultModality,
            description: escalationResult.message,
            priority: escalationResult.priority,
            taskId,
            role: escalationResult.role || wfConfig?.role || defaultRole,
            envelope: JSON.stringify(escalationResult.data),
            escalationPayload: JSON.stringify(escalationResult.data),
            workflowId,
            taskQueue,
            workflowType: workflowName,
          });

          // Pause: wait for human resolution
          const resolver = await MemFlow.workflow.waitFor<Record<string, any>>(signalId);

          // Resolve the escalation record durably
          await ltResolveEscalation({ escalationId, resolverPayload: resolver });

          // Standalone mode: complete the task
          if (!isOrchestrated) {
            const milestones: LTMilestone[] = [
              { name: 'escalated', value: true, created_at: new Date().toISOString() },
              { name: 'resolved_by_human', value: true, created_at: new Date().toISOString() },
            ];
            await ltCompleteTask({
              taskId: taskId!,
              data: JSON.stringify(resolver),
              milestones,
            });
          }

          return {
            type: 'return',
            data: resolver,
            milestones: [
              { name: 'escalated', value: true },
              { name: 'resolved_by_human', value: true },
            ],
          } satisfies LTReturn;
        }

        // ── Success path ───────────────────────────────────────────
        if (result?.type === 'return') {
          const returnResult = result as LTReturn;

          // Standalone mode: create + complete task
          const existingTask = await ltGetTaskByWorkflowId(workflowId);
          if (!existingTask) {
            const taskId = await ltCreateTask({
              workflowId,
              workflowType: workflowName,
              ltType: workflowName,
              signalId,
              parentWorkflowId: workflowId,
              envelope: '{}',
            });
            await ltCompleteTask({
              taskId,
              data: JSON.stringify(returnResult.data),
              milestones: returnResult.milestones,
            });
          }
        }

        return result;
      } catch (err: any) {
        // Always rethrow engine interruptions (replay signals)
        if (MemFlow.workflow.didInterrupt(err)) {
          throw err;
        }

        // ── Error escalation path ──────────────────────────────────
        // Unhandled errors become escalations so the workflow never dies
        const existingTask = await ltGetTaskByWorkflowId(workflowId);
        const isOrchestrated = !!existingTask;
        let taskId = existingTask?.id;

        if (!isOrchestrated) {
          taskId = await ltCreateTask({
            workflowId,
            workflowType: workflowName,
            ltType: workflowName,
            signalId,
            parentWorkflowId: workflowId,
            envelope: '{}',
          });
          await ltStartTask(taskId!);
        }

        await ltEscalateTask(taskId!);

        const errorEscalationId = await ltCreateEscalation({
          type: workflowName,
          subtype: workflowName,
          modality: wfConfig?.modality || defaultModality,
          description: `Unhandled error: ${err.message || String(err)}`,
          taskId,
          role: wfConfig?.role || defaultRole,
          envelope: JSON.stringify({ error: err.message }),
          escalationPayload: JSON.stringify({ error: err.message, stack: err.stack }),
          workflowId,
          taskQueue,
          workflowType: workflowName,
        });

        const resolver = await MemFlow.workflow.waitFor<Record<string, any>>(signalId);

        // Resolve the escalation record durably
        await ltResolveEscalation({ escalationId: errorEscalationId, resolverPayload: resolver });

        if (!isOrchestrated) {
          await ltCompleteTask({
            taskId: taskId!,
            data: JSON.stringify(resolver),
            milestones: [
              { name: 'error_escalation', value: err.message },
              { name: 'resolved_by_human', value: true },
            ],
          });
        }

        return {
          type: 'return',
          data: resolver,
          milestones: [
            { name: 'error_escalation', value: err.message },
            { name: 'resolved_by_human', value: true },
          ],
        } satisfies LTReturn;
      }
    },
  };

  return interceptor;
}
