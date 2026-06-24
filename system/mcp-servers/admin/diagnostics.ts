/**
 * Diagnostics tools — mirrors routes/diagnostics.ts. Pure read-only.
 *
 * Three tools:
 *   diagnose_job            — per-job verdict (compact by default; opt into events/streams)
 *   find_stalled_jobs       — fleet-level: running jobs with no recent status change
 *   find_orphaned_signals   — fleet-level: suspended waiters with no escalation row
 *
 * Efficient usage: start fleet-wide (find_orphaned_signals for the genuinely
 * broken case, find_stalled_jobs for candidates), then call diagnose_job on a
 * specific id for root cause — do not fan diagnose_job across every job.
 * diagnose_job returns the verdict only by default; add include: ['events'] or
 * ['streams'] for the heavy arrays. For full raw message payloads, use the
 * stream browser (list_stream_messages filtered by jid).
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
        'Read-only diagnosis for a single workflow job. Compact by default — returns the ' +
        'verdict only: status, idle_for_ms, workflow_type, stream_summary (counts), the ' +
        'escalation row from hmsh_escalations, and structured findings[] with confidence, ' +
        'evidence, and read-only guidance (where to look next — never recovery; HotMesh ' +
        'state cannot be unwound). ' +
        'A workflow sitting at a condition()/waitFor()/sleepFor() for a long time is ' +
        'classified as a healthy wait, not a fault — only dead-letter, reservation-leak, ' +
        'or a suspended-waiter-with-no-escalation indicate a real problem. ' +
        'To opt into the heavy arrays pass include: ["events"] for the execution timeline ' +
        '(capped by max_events, default 500) and/or include: ["streams"] for raw engine+worker ' +
        'messages; large result/message payloads are summarized to {bytes,preview,truncated}. ' +
        'For full untruncated payloads use list_stream_messages filtered by jid (returned in ' +
        'raw_messages). Call find_orphaned_signals / find_stalled_jobs first to surface IDs, ' +
        'then this per job.',
      inputSchema: diagnoseJobSchema,
    },
    async (args: z.infer<typeof diagnoseJobSchema>) => {
      const result = await api.diagnose({ workflowId: args.workflow_id, appId: args.app_id, maxEvents: args.max_events, include: args.include, verbosity: args.verbosity });
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
