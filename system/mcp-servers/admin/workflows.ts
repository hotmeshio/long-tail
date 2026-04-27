/**
 * Workflow discovery and invocation tools — mirrors routes/workflows/discovery.ts
 * and routes/workflows/invocation.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as configService from '../../../services/config';
import { getRegisteredWorkers, SYSTEM_WORKFLOWS } from '../../../services/workers/registry';
import {
  invokeWorkflow,
  checkInvocationRoles,
} from '../../../services/workflow-invocation';
import { createClient } from '../../../workers';
import {
  listDiscoveredWorkflowsSchema,
  invokeWorkflowSchema,
  getWorkflowStatusSchema,
} from './schemas';

export function registerWorkflowTools(server: McpServer): void {

  // mirrors GET /api/workflows/discovered
  (server as any).registerTool(
    'list_discovered_workflows',
    {
      title: 'List Discovered Workflows',
      description:
        'Unified list of all known workflows: active workers, historical ' +
        'entities, and registered configs merged together. Shows which are ' +
        'certified (registered), active, invocable, and their roles.',
      inputSchema: listDiscoveredWorkflowsSchema,
    },
    async (args: z.infer<typeof listDiscoveredWorkflowsSchema>) => {
      const activeWorkers = getRegisteredWorkers();
      const configs = await configService.listWorkflowConfigs();
      const configMap = new Map(configs.map((c) => [c.workflow_type, c]));

      const allTypes = new Set<string>();
      for (const [name] of activeWorkers) allTypes.add(name);
      for (const c of configs) allTypes.add(c.workflow_type);

      const workflows = [...allTypes]
        .filter((t) => args.include_system || !SYSTEM_WORKFLOWS.has(t))
        .sort()
        .map((wt) => {
          const config = configMap.get(wt);
          const worker = activeWorkers.get(wt);
          const hasCertification = !!(
            config &&
            ((config.roles?.length ?? 0) > 0 ||
             (config.consumes?.length ?? 0) > 0 ||
             config.resolver_schema)
          );
          const tier = !config ? 'durable' : hasCertification ? 'certified' : 'configured';
          return {
            workflow_type: wt,
            task_queue: config?.task_queue ?? worker?.taskQueue ?? null,
            tier,
            registered: !!config,
            active: !!worker,
            invocable: config?.invocable ?? false,
            description: config?.description ?? null,
            roles: config?.roles ?? [],
          };
        });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: workflows.length, workflows }),
        }],
      };
    },
  );

  // mirrors POST /api/workflows/:type/invoke
  (server as any).registerTool(
    'invoke_workflow',
    {
      title: 'Invoke Workflow',
      description:
        'Start a certified workflow by type. The workflow must have invocable=true ' +
        'in its config. Returns the workflow ID immediately; the workflow runs ' +
        'durably in the background.',
      inputSchema: invokeWorkflowSchema,
    },
    async (args: z.infer<typeof invokeWorkflowSchema>) => {
      const result = await invokeWorkflow({
        workflowType: args.workflow_type,
        data: args.data,
        metadata: args.metadata,
        executeAs: args.execute_as,
        auth: { userId: 'lt-system', role: 'superadmin' },
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ workflow_id: result.workflowId, message: 'Workflow started' }),
        }],
      };
    },
  );

  // mirrors GET /api/workflows/:workflowId/status + /result
  (server as any).registerTool(
    'get_workflow_status',
    {
      title: 'Get Workflow Status',
      description:
        'Check the status and result of a workflow execution. Returns ' +
        'status (0=complete, positive=running) and the result if complete.',
      inputSchema: getWorkflowStatusSchema,
    },
    async (args: z.infer<typeof getWorkflowStatusSchema>) => {
      const { getTaskByWorkflowId } = await import('../../../services/task');
      const task = await getTaskByWorkflowId(args.workflow_id);
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Workflow not found' }) }],
          isError: true,
        };
      }
      const client = createClient();
      const handle = await client.workflow.getHandle(
        task.task_queue || 'long-tail-system',
        task.workflow_type,
        args.workflow_id,
      );
      const status = await handle.status();
      if (status !== 0) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ workflow_id: args.workflow_id, status: 'running' }),
          }],
        };
      }
      const result = await handle.result();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ workflow_id: args.workflow_id, status: 'complete', result }),
        }],
      };
    },
  );
}
