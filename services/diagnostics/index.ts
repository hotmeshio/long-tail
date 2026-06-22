import { getPool } from '../../lib/db';
import { exportWorkflowExecution } from '../export';
import { getStreamMessages } from '../controlplane';
import { resolveWorkflowHandle } from '../task/resolve';
import { matchPatterns } from './patterns';
import type { Finding } from './patterns';
import type { StreamMessage } from '../controlplane/types';

export type { Finding };

// ── SQL ──────────────────────────────────────────────────────────────────────

const ESCALATION_BY_JOB = `
  SELECT id, status, signal_key, role, type, assigned_to, created_at
  FROM public.hmsh_escalations
  WHERE workflow_id = $1
  ORDER BY created_at DESC LIMIT 5
`;

const STALLED_JOBS = (appId: string) => `
  SELECT
    REPLACE(j.key, $1, '') AS workflow_id,
    j.entity               AS workflow_type,
    j.status,
    j.created_at,
    j.updated_at,
    EXTRACT(EPOCH FROM (NOW() - j.updated_at)) * 1000 AS stalled_ms
  FROM "${appId}".jobs j
  WHERE j.status > 0
    AND j.is_live = TRUE
    AND j.updated_at < NOW() - ($2 || ' minutes')::INTERVAL
    AND ($3::text IS NULL OR j.entity = $3)
  ORDER BY j.updated_at ASC
  LIMIT $4
`;

const ORPHANED_SIGNALS = (appId: string) => `
  WITH committed_waiters AS (
    SELECT
      ws.jid                                AS job_id,
      ws.message->'data'->>'signalId'       AS signal_id,
      ws.message->'data'->>'queueConfig'    AS queue_config,
      ws.workflow_name,
      ws.created_at                         AS suspended_at
    FROM "${appId}".worker_streams ws
    WHERE ws.aid LIKE '%/waiter'
      AND ws.expired_at IS NOT NULL
      AND ws.dead_lettered_at IS NULL
  ),
  live_jobs AS (
    SELECT REPLACE(key, 'hmsh:${appId}:j:', '') AS wid
    FROM "${appId}".jobs
    WHERE status > 0 AND is_live = TRUE
  )
  SELECT
    cw.job_id,
    cw.signal_id,
    cw.workflow_name,
    cw.suspended_at,
    EXTRACT(EPOCH FROM (NOW() - cw.suspended_at)) * 1000 AS stalled_ms,
    cw.queue_config IS NULL AS missing_queue_config
  FROM committed_waiters cw
  JOIN live_jobs lj ON lj.wid = cw.job_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.hmsh_escalations e WHERE e.workflow_id = cw.job_id
  )
  ORDER BY cw.suspended_at ASC
  LIMIT $1
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface EscalationSummary {
  exists: boolean;
  id: string | null;
  status: string | null;
  signal_key: string | null;
  role: string | null;
  type: string | null;
  created_at: string | null;
}

export interface StreamSummary {
  worker_total: number;
  engine_total: number;
  dead_lettered: number;
  pending: number;
  in_flight: number;
}

export interface JobDiagnosis {
  workflow_id: string;
  app_id: string;
  status: 'running' | 'completed' | 'failed' | 'not_found';
  stalled_for_ms: number | null;
  workflow_type: string | null;
  last_event_at: string | null;
  stream_summary: StreamSummary;
  escalation: EscalationSummary;
  findings: Finding[];
  execution_events: unknown[];
  stream_messages: { worker: StreamMessage[]; engine: StreamMessage[] };
}

// ── diagnoseJob ──────────────────────────────────────────────────────────────

export async function diagnoseJob(
  workflowId: string,
  appId = 'durable',
): Promise<JobDiagnosis> {
  const pool = getPool();

  let resolved: { taskQueue: string; workflowName: string };
  try {
    resolved = await resolveWorkflowHandle(workflowId);
  } catch {
    return notFound(workflowId, appId);
  }

  const [execution, workerResult, engineResult, escalationResult] = await Promise.all([
    exportWorkflowExecution(workflowId, resolved.taskQueue, resolved.workflowName)
      .catch(() => null),
    getStreamMessages(appId, { source: 'worker', jid: workflowId, limit: 100, order: 'asc' }),
    getStreamMessages(appId, { source: 'engine', jid: workflowId, limit: 100, order: 'asc' }),
    pool.query(ESCALATION_BY_JOB, [workflowId]),
  ]);

  const escalationRow = escalationResult.rows[0] ?? null;
  const workerMessages = workerResult.messages;
  const engineMessages = engineResult.messages;
  const events = execution?.events ?? [];
  const lastEvent = events.at(-1);
  const now = Date.now();

  const isCompleted = events.some(e => e.event_type === 'workflow_execution_completed');
  const isFailed = events.some(e => e.event_type === 'workflow_execution_failed');
  const status: JobDiagnosis['status'] = isCompleted ? 'completed' : isFailed ? 'failed' : 'running';

  const lastEventAt = lastEvent?.event_time ?? null;
  const stalledMs = status === 'running' && lastEventAt
    ? now - new Date(lastEventAt).getTime()
    : null;

  const allMessages = [...workerMessages, ...engineMessages];
  const streamSummary: StreamSummary = {
    worker_total: workerMessages.length,
    engine_total: engineMessages.length,
    dead_lettered: allMessages.filter(m => m.dead_lettered_at).length,
    pending: allMessages.filter(m => !m.reserved_at && !m.expired_at && !m.dead_lettered_at).length,
    in_flight: allMessages.filter(m => m.reserved_at && !m.expired_at && !m.dead_lettered_at).length,
  };

  const findings = execution
    ? matchPatterns(execution, workerMessages, engineMessages, escalationRow)
    : [{ condition: 'export_unavailable', confidence: 0.9, severity: 'warning' as const, evidence: ['Execution export unavailable — job may have expired or HotMesh engine is not running'], treatment: [] }];

  return {
    workflow_id: workflowId,
    app_id: appId,
    status,
    stalled_for_ms: stalledMs,
    workflow_type: resolved.workflowName,
    last_event_at: lastEventAt,
    stream_summary: streamSummary,
    escalation: {
      exists: !!escalationRow,
      id: escalationRow?.id ?? null,
      status: escalationRow?.status ?? null,
      signal_key: escalationRow?.signal_key ?? null,
      role: escalationRow?.role ?? null,
      type: escalationRow?.type ?? null,
      created_at: escalationRow?.created_at ?? null,
    },
    findings,
    execution_events: events,
    stream_messages: { worker: workerMessages, engine: engineMessages },
  };
}

// ── findStalledJobs ──────────────────────────────────────────────────────────

export async function findStalledJobs(params: {
  appId?: string;
  stalledMinutes?: number;
  workflowType?: string | null;
  limit?: number;
}): Promise<{ jobs: unknown[]; total: number }> {
  const appId = params.appId ?? 'durable';
  const stalledMinutes = params.stalledMinutes ?? 5;
  const limit = Math.min(params.limit ?? 50, 200);
  const keyPrefix = `hmsh:${appId}:j:`;

  const pool = getPool();
  const { rows } = await pool.query(STALLED_JOBS(appId), [
    keyPrefix,
    String(stalledMinutes),
    params.workflowType ?? null,
    limit,
  ]).catch(() => ({ rows: [] }));

  return { jobs: rows, total: rows.length };
}

// ── findOrphanedSignals ──────────────────────────────────────────────────────

export async function findOrphanedSignals(params: {
  appId?: string;
  limit?: number;
}): Promise<{ orphans: unknown[]; total: number }> {
  const appId = params.appId ?? 'durable';
  const limit = Math.min(params.limit ?? 100, 500);

  const pool = getPool();
  const { rows } = await pool.query(ORPHANED_SIGNALS(appId), [limit])
    .catch(() => ({ rows: [] }));

  return { orphans: rows, total: rows.length };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function notFound(workflowId: string, appId: string): JobDiagnosis {
  return {
    workflow_id: workflowId,
    app_id: appId,
    status: 'not_found',
    stalled_for_ms: null,
    workflow_type: null,
    last_event_at: null,
    stream_summary: { worker_total: 0, engine_total: 0, dead_lettered: 0, pending: 0, in_flight: 0 },
    escalation: { exists: false, id: null, status: null, signal_key: null, role: null, type: null, created_at: null },
    findings: [{ condition: 'not_found', confidence: 1, severity: 'critical', evidence: ['Workflow ID not found — no task record or job entity'], treatment: [] }],
    execution_events: [],
    stream_messages: { worker: [], engine: [] },
  };
}
