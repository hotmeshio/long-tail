/**
 * Export tools — mirrors routes/exports.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/exports';
import {
  listExportJobsSchema,
  exportWorkflowStateSchema,
  exportWorkflowExecutionSchema,
  getExportStatusSchema,
} from './schemas';

export function registerExportTools(server: McpServer): void {

  // mirrors GET /api/workflow-states/jobs
  (server as any).registerTool(
    'list_export_jobs',
    {
      title: 'List Export Jobs',
      description:
        'List workflow jobs with optional filtering and pagination.',
      inputSchema: listExportJobsSchema,
    },
    async (args: z.infer<typeof listExportJobsSchema>) => {
      const result = await api.listJobs(args);
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/workflow-states/:workflowId
  (server as any).registerTool(
    'export_workflow_state',
    {
      title: 'Export Workflow State',
      description:
        'Export the full workflow state using HotMesh durable export. ' +
        'Optionally allow/block specific fields.',
      inputSchema: exportWorkflowStateSchema,
    },
    async (args: z.infer<typeof exportWorkflowStateSchema>) => {
      const result = await api.exportWorkflowState({
        workflowId: args.workflow_id,
        allow: args.allow as any,
        block: args.block as any,
        values: args.values as any,
      });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/workflow-states/:workflowId/execution
  (server as any).registerTool(
    'export_workflow_execution',
    {
      title: 'Export Workflow Execution',
      description:
        'Export workflow state as a structured execution event history. ' +
        'Useful for debugging and workflow compilation.',
      inputSchema: exportWorkflowExecutionSchema,
    },
    async (args: z.infer<typeof exportWorkflowExecutionSchema>) => {
      const result = await api.exportWorkflowExecution({
        workflowId: args.workflow_id,
        excludeSystem: args.excludeSystem,
        omitResults: args.omitResults,
        mode: args.mode as any,
        maxDepth: args.maxDepth,
      });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/workflow-states/:workflowId/status
  (server as any).registerTool(
    'get_export_status',
    {
      title: 'Get Workflow Status',
      description: 'Return the numeric status semaphore for a workflow.',
      inputSchema: getExportStatusSchema,
    },
    async (args: z.infer<typeof getExportStatusSchema>) => {
      const result = await api.getWorkflowStatus({ workflowId: args.workflow_id });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
