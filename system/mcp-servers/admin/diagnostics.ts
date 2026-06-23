/**
 * Diagnostics tools — mirrors routes/diagnostics.ts. Pure read-only.
 *
 * Three tools:
 *   diagnose_job            — full per-job diagnosis: events + stream messages + findings
 *   find_stalled_jobs       — fleet-level: running jobs with no recent status change
 *   find_orphaned_signals   — fleet-level: suspended waiters with no escalation row
 *
 * Efficient usage: start fleet-wide (find_orphaned_signals for the genuinely
 * broken case, find_stalled_jobs for candidates), then call diagnose_job on a
 * specific id for root cause — do not fan diagnose_job across every job. For
 * full raw message payloads, use the stream browser (list_stream_messages
 * filtered by jid), not diagnose_job, which returns a capped summary.
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
        'Read-only diagnosis for a single workflow job. Combines the execution event ' +
        'timeline (from exportWorkflowExecution) with the raw stream messages for that ' +
        'job (engine + worker, including retry state and timing) and the escalation row ' +
        'from hmsh_escalations. Returns structured findings[] with confidence, evidence, ' +
        'and read-only guidance (where to look next — never recovery; HotMesh state ' +
        'cannot be unwound). ' +
        'A workflow sitting at a condition()/waitFor()/sleepFor() for a long time is ' +
        'classified as a healthy wait, not a fault — only dead-letter, reservation-leak, ' +
        'or a suspended-waiter-with-no-escalation indicate a real problem. ' +
        'Events are capped (max_events, default 500); for full raw message payloads use ' +
        'the stream browser (list_stream_messages filtered by jid). Call ' +
        'find_orphaned_signals / find_stalled_jobs first to surface IDs, then this per job.',
      inputSchema: diagnoseJobSchema,
    },
    async (args: z.infer<typeof diagnoseJobSchema>) => {
      const result = await api.diagnose({ workflowId: args.workflow_id, appId: args.app_id, maxEvents: args.max_events });
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
        'Find running jobs with no status change in N minutes (bounded, indexed; cap 200). ' +
        'IMPORTANT: "no recent change" is NOT "broken" — HotMesh bumps updated_at only on ' +
        'status change, so a frozen timestamp is the normal signature of a workflow waiting ' +
        'at a condition()/waitFor()/sleepFor(). Each row carries a `likely` classification: ' +
        '"waiting" (has a pending escalation — healthy) vs "no_recent_progress" (worth a ' +
        'closer look). Returns workflow_id, workflow_type, idle_ms, has_open_escalation, likely. ' +
        'Triage the "no_recent_progress" rows with diagnose_job for root cause.',
      inputSchema: findStalledJobsSchema,
    },
    async (args: z.infer<typeof findStalledJobsSchema>) => {
      const result = await api.stalledJobs({
        appId: args.app_id,
        idleMinutes: args.idle_minutes,
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
        'Find running workflows suspended at a condition() (waiter committed, signal ' +
        'registered) that have NO escalation row in hmsh_escalations — the genuinely ' +
        'broken case: the workflow waits for a signal nothing will send. ' +
        'Scans a recent window only (within_hours, default 24, max 720) to stay off a ' +
        'full-history scan of the partitioned worker_streams table; widen the window ' +
        'deliberately to reach older orphans, narrow it to go faster. ' +
        'Returns job_id, signal_id, workflow_name, suspended_at, waiting_ms, and ' +
        'missing_queue_config (true = pre-0.22 SDK, false = error at commit time), plus ' +
        'the within_hours actually applied. Call diagnose_job on any result for the full ' +
        'picture. This is read-only — resolving an orphan needs engineering review.',
      inputSchema: findOrphanedSignalsSchema,
    },
    async (args: z.infer<typeof findOrphanedSignalsSchema>) => {
      const result = await api.orphanedSignals({ appId: args.app_id, withinHours: args.within_hours, limit: args.limit });
      if (result.error) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
    },
  );
}
