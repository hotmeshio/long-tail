/**
 * Pipeline tools — mirrors routes/pipelines.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/pipelines';
import {
  listPipelineEntitiesSchema,
  listPipelineJobsSchema,
  getJobExecutionSchema,
  interruptJobSchema,
} from './schemas';

export function registerPipelineTools(server: McpServer): void {

  // mirrors GET /api/pipelines/entities
  (server as any).registerTool(
    'list_pipeline_entities',
    {
      title: 'List Pipeline Entities',
      description:
        'List distinct entity (tool) names from pipeline jobs, supplemented ' +
        'with graph topics from compiled YAML workflows.',
      inputSchema: listPipelineEntitiesSchema,
    },
    async (args: z.infer<typeof listPipelineEntitiesSchema>) => {
      const result = await api.listEntities({ app_id: args.app_id || 'durable' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/pipelines
  (server as any).registerTool(
    'list_pipeline_jobs',
    {
      title: 'List Pipeline Jobs',
      description:
        'List pipeline jobs with optional entity, search, and status filters.',
      inputSchema: listPipelineJobsSchema,
    },
    async (args: z.infer<typeof listPipelineJobsSchema>) => {
      const result = await api.listJobs({ ...args, app_id: args.app_id || 'durable' });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors GET /api/pipelines/:jobId/execution
  (server as any).registerTool(
    'get_pipeline_execution',
    {
      title: 'Get Pipeline Execution',
      description: 'Export execution details for a specific pipeline job.',
      inputSchema: getJobExecutionSchema,
    },
    async (args: z.infer<typeof getJobExecutionSchema>) => {
      const result = await api.getJobExecution({
        jobId: args.job_id,
        app_id: args.app_id || 'durable',
      });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  // mirrors POST /api/pipelines/:jobId/interrupt
  (server as any).registerTool(
    'interrupt_pipeline_job',
    {
      title: 'Interrupt Pipeline Job',
      description: 'Interrupt a running pipeline job.',
      inputSchema: interruptJobSchema,
    },
    async (args: z.infer<typeof interruptJobSchema>) => {
      const result = await api.interruptJob({
        jobId: args.job_id,
        topic: args.topic,
        app_id: args.app_id || 'durable',
      });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
