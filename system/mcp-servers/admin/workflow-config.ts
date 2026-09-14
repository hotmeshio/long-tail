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
import { resolveLookupContext } from '../../../services/knowledge/lookup-cache';
import { describeMissingLookupRefs } from '../../../services/knowledge/lookup-refs';
import { ltConfig } from '../../../modules/ltconfig';
import { cronRegistry } from '../../../services/cron';
import { WORKFLOW_TIERS } from '../../../api/workflows/invocable';
import { isWorkflowIcon } from '../../../types/workflow-icons';
import { assertLookupRefs } from '../../../types/escalation';
import type { LTWorkflowConfig } from '../../../types/config';
import {
  listWorkflowConfigsSchema,
  getWorkflowConfigSchema,
  upsertWorkflowConfigSchema,
  deleteWorkflowConfigSchema,
} from './schemas';

const errorResult = (error: string) => ({
  content: [{ type: 'text' as const, text: JSON.stringify({ error }) }],
  isError: true,
});

export function registerWorkflowConfigTools(server: McpServer): void {

  // mirrors GET /api/workflows/config
  (server as any).registerTool(
    'list_workflow_configs',
    {
      title: 'List Workflow Configs',
      description:
        'List all certified workflow configurations. Shows workflow type, ' +
        'task queue, roles, invocable flag, and description. Call ' +
        'get_workflow_config for the full row including input_schema.',
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

  // mirrors GET /api/workflows/:type/config, plus the resolved lookup data the form reads
  (server as any).registerTool(
    'get_workflow_config',
    {
      title: 'Get Workflow Config',
      description:
        'The full configuration row for one workflow: input_schema (the x-lt-* form ' +
        'an invoke payload must satisfy), envelope_schema (its metadata is the base ' +
        'of every run), input_lookups, roles, and tier. input_lookup_data carries the ' +
        'resolved knowledge editions keyed as the form reads them (lookup.<as ?? key>).',
      inputSchema: getWorkflowConfigSchema,
    },
    async (args: z.infer<typeof getWorkflowConfigSchema>) => {
      const config = await configService.getWorkflowConfig(args.workflow_type);
      if (!config) return errorResult('Workflow config not found');
      const tier = config.certified ? WORKFLOW_TIERS.CERTIFIED : WORKFLOW_TIERS.REGISTERED;
      const input_lookup_data = await resolveLookupContext(config.input_lookups);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ...config, tier, input_lookup_data }) }],
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
        'Full replace, matching PUT /api/workflows/:type/config: omitted fields clear ' +
        'to their defaults, so send the whole profile (start from get_workflow_config). ' +
        'Invalidates the config cache and restarts cron if schedule changes.',
      inputSchema: upsertWorkflowConfigSchema,
    },
    async (args: z.infer<typeof upsertWorkflowConfigSchema>) => {
      if (args.icon && !isWorkflowIcon(args.icon)) {
        return errorResult(`Unknown workflow icon "${args.icon}"; choose one of WORKFLOW_ICONS`);
      }
      if (args.input_lookups != null) {
        try {
          assertLookupRefs(args.input_lookups);
        } catch (err: any) {
          return errorResult(err.message);
        }
        const missing = await describeMissingLookupRefs(args.input_lookups);
        if (missing.length) return errorResult(missing.join('; '));
      }
      const declaration: LTWorkflowConfig = {
        workflow_type: args.workflow_type,
        invocable: args.invocable,
        certified: args.certified,
        task_queue: args.task_queue,
        default_role: args.default_role,
        description: args.description,
        execute_as: args.execute_as,
        roles: args.roles,
        invocation_roles: args.invocation_roles,
        consumes: args.consumes,
        tool_tags: args.tool_tags,
        envelope_schema: args.envelope_schema,
        input_schema: args.input_schema,
        input_lookups: args.input_lookups,
        icon: args.icon,
        read_safe: args.read_safe,
        resolver_schema: args.resolver_schema,
        cron_schedule: args.cron_schedule,
      };
      const config = await configService.upsertWorkflowConfig(declaration);
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
      if (!deleted) return errorResult('Workflow config not found');
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
