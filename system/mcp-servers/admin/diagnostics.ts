/**
 * Diagnostics tools — mirrors routes/diagnostics.ts
 *
 * Three tools:
 *   diagnose_job            — full per-job diagnosis: events + stream messages + findings
 *   find_stalled_jobs       — fleet-level: running jobs with no recent progress
 *   find_orphaned_signals   — fleet-level: suspended jobs with no escalation row
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as api from '../../../api/diagnostics';
import { diagnoseJobSchema, findStalledJobsSchema, findOrphanedSignalsSchema } from './schemas';

export function registerDiagnosticsTools(server: McpServer): void {

  (server as any).registerTool(
    'diagnose_job',
    {
      title: 'Diagnose Job',
      description:
        'Complete diagnostic for a single workflow job. Combines the execution event ' +
        'timeline (from exportWorkflowExecution) with the raw stream messages for that ' +
        'job (engine + worker, including full JSONB payload, retry state, and timing) ' +
        'and the escalation row from hmsh_escalations. Returns structured findings[] ' +
        'with confidence, evidence, and treatment options. ' +
        'Use when a workflow is stalled, stuck at a condition, has dead-lettered ' +
        'messages, or shows unexpected behavior. Call find_stalled_jobs or ' +
        'find_orphaned_signals first to surface job IDs, then call this per job.',
      inputSchema: diagnoseJobSchema,
    },
    async (args: z.infer<typeof diagnoseJobSchema>) => {
      const result = await api.diagnose({ workflowId: args.workflow_id, appId: args.app_id });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  (server as any).registerTool(
    'find_stalled_jobs',
    {
      title: 'Find Stalled Jobs',
      description:
        'Find all running jobs that have not progressed in N minutes. ' +
        'Returns workflow_id, workflow_type, stalled_ms, created_at, updated_at. ' +
        'Use as a first step to surface the scope of a stall incident. ' +
        'Follow up with diagnose_job on individual results for root cause.',
      inputSchema: findStalledJobsSchema,
    },
    async (args: z.infer<typeof findStalledJobsSchema>) => {
      const result = await api.stalledJobs({
        appId: args.app_id,
        stalledMinutes: args.stalled_minutes,
        workflowType: args.workflow_type,
        limit: args.limit,
      });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );

  (server as any).registerTool(
    'find_orphaned_signals',
    {
      title: 'Find Orphaned Signals',
      description:
        'Find running workflows that are suspended at a condition() call ' +
        '(waiter Leg1 committed, signal registered) but have no corresponding ' +
        'escalation row in hmsh_escalations. These are permanently stalled — ' +
        'the workflow is waiting for a signal that nothing will ever send. ' +
        'Returns job_id, signal_id, workflow_name, suspended_at, stalled_ms, ' +
        'and missing_queue_config (true = pre-0.22 SDK, false = DB error at commit time). ' +
        'Call diagnose_job on any result for the full picture and recovery options.',
      inputSchema: findOrphanedSignalsSchema,
    },
    async (args: z.infer<typeof findOrphanedSignalsSchema>) => {
      const result = await api.orphanedSignals({ appId: args.app_id, limit: args.limit });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
