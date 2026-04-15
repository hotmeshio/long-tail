/**
 * Workflow configuration tools — mirrors routes/workflows/config.ts
 *
 * Certifying a workflow creates an lt_config_workflows entry, which
 * activates the interceptor for task tracking, escalation chains,
 * and the never-fail guarantee. De-certifying removes it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as configService from '../../../services/config';
import { ltConfig } from '../../../modules/ltconfig';
import { cronRegistry } from '../../../services/cron';
import {
  listWorkflowConfigsSchema,
  upsertWorkflowConfigSchema,
  deleteWorkflowConfigSchema,
} from './schemas';

export function registerWorkflowConfigTools(server: McpServer): void {

  // mirrors GET /api/workflows/config
  (server as any).registerTool(
    'list_workflow_configs',
    {
      title: 'List Workflow Configs',
      description:
        'List all certified workflow configurations. Shows workflow type, ' +
        'task queue, roles, invocable flag, and description.',
      inputSchema: listWorkflowConfigsSchema,
    },
    async (_args: z.infer<typeof listWorkflowConfigsSchema>) => {
      const configs = await configService.listWorkflowConfigs();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            count: configs.length,
            workflows: configs.map((c) => ({
              workflow_type: c.workflow_type,
              invocable: c.invocable,
              task_queue: c.task_queue,
              default_role: c.default_role,
              description: c.description,
              roles: c.roles,
            })),
          }),
        }],
      };
    },
  );

  // mirrors PUT /api/workflows/:type/config
  (server as any).registerTool(
    'upsert_workflow_config',
    {
      title: 'Upsert Workflow Config',
      description:
        'Create or replace a workflow configuration (certify). Activates the ' +
        'interceptor for task tracking, escalation chains, and invocation controls. ' +
        'Invalidates the config cache and restarts cron if schedule changes.',
      inputSchema: upsertWorkflowConfigSchema,
    },
    async (args: z.infer<typeof upsertWorkflowConfigSchema>) => {
      const config = await configService.upsertWorkflowConfig({
        workflow_type: args.workflow_type,
        invocable: args.invocable,
        task_queue: args.task_queue,
        default_role: args.default_role,
        description: args.description,
        execute_as: args.execute_as,
        roles: args.roles,
        invocation_roles: args.invocation_roles,
        consumes: args.consumes,
        tool_tags: args.tool_tags,
        envelope_schema: args.envelope_schema,
        resolver_schema: args.resolver_schema,
        cron_schedule: args.cron_schedule,
      });
      ltConfig.invalidate();
      await cronRegistry.restartCron(config);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(config) }],
      };
    },
  );

  // mirrors DELETE /api/workflows/:type/config
  (server as any).registerTool(
    'delete_workflow_config',
    {
      title: 'Delete Workflow Config',
      description:
        'De-certify a workflow by removing its lt_config_workflows entry. ' +
        'The workflow remains durable but loses interceptor wrapping.',
      inputSchema: deleteWorkflowConfigSchema,
    },
    async (args: z.infer<typeof deleteWorkflowConfigSchema>) => {
      const deleted = await configService.deleteWorkflowConfig(args.workflow_type);
      if (!deleted) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Workflow config not found' }) }],
          isError: true,
        };
      }
      ltConfig.invalidate();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ deleted: true, workflow_type: args.workflow_type }),
        }],
      };
    },
  );
}
