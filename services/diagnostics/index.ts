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

// "No recent status change" is NOT the same as "broken": HotMesh only bumps
// jobs.updated_at when status changes, so a frozen updated_at is the normal
// signature of a workflow waiting at a condition()/waitFor()/sleepFor(). We
// classify each row with `has_open_escalation` (a cheap, workflow_id-indexed
// EXISTS bounded by the outer LIMIT) so callers can tell a healthy wait
// (`likely = waiting`) from a candidate worth a closer look (`no_recent_progress`).
const STALLED_JOBS = (appId: string) => `
  SELECT
    q.*,
    CASE WHEN q.has_open_escalation THEN 'waiting' ELSE 'no_recent_progress' END AS likely
  FROM (
    SELECT
      REPLACE(j.key, $1, '') AS workflow_id,
      j.entity               AS workflow_type,
      j.status,
      j.created_at,
      j.updated_at,
      EXTRACT(EPOCH FROM (NOW() - j.updated_at)) * 1000 AS idle_ms,
      EXISTS (
        SELECT 1 FROM public.hmsh_escalations e
        WHERE e.workflow_id = REPLACE(j.key, $1, '') AND e.status = 'pending'
      ) AS has_open_escalation
    FROM "${appId}".jobs j
    WHERE j.status > 0
      AND j.is_live = TRUE
      AND j.updated_at < NOW() - ($2 || ' minutes')::INTERVAL
      AND ($3::text IS NULL OR j.entity = $3)
    ORDER BY j.updated_at ASC
    LIMIT $4
  ) q
`;

// Bounded by a recent-time window ($1 = within_hours) so this never degenerates
// into a full-history scan of the HASH-partitioned worker_streams table. The
// `aid LIKE '%/waiter'` predicate is a suffix wildcard (not index-backed), so
// the time window is what keeps the intermediate scan small; widening it trades
// cost for reach. The NOT EXISTS anti-join on hmsh_escalations (workflow_id
// indexed) is the high-value signal — a suspended waiter with no escalation row.
const ORPHANED_SIGNALS = (appId: string) => `
  WITH committed_waiters AS (
    SELECT
      ws.jid                                     AS job_id,
      ws.message::jsonb->'data'->>'signalId'     AS signal_id,
      ws.message::jsonb->'data'->>'queueConfig'  AS queue_config,
      ws.workflow_name,
      ws.created_at                              AS suspended_at
    FROM "${appId}".worker_streams ws
    WHERE ws.aid LIKE '%/waiter'
      AND ws.expired_at IS NOT NULL
      AND ws.dead_lettered_at IS NULL
      AND ws.created_at > NOW() - ($1 || ' hours')::INTERVAL
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
    EXTRACT(EPOCH FROM (NOW() - cw.suspended_at)) * 1000 AS waiting_ms,
    cw.queue_config IS NULL AS missing_queue_config
  FROM committed_waiters cw
  JOIN live_jobs lj ON lj.wid = cw.job_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.hmsh_escalations e WHERE e.workflow_id = cw.job_id
  )
  ORDER BY cw.suspended_at ASC
  LIMIT $2
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

/** A large string field replaced with a bounded summary instead of the full payload. */
export interface TruncatedString {
  bytes: number;
  preview: string;
  truncated: true;
}

/** Pointer to the stream browser for the raw, untruncated message payloads. */
export interface RawMessagesHint {
  hint: string;
  jid: string;
}

/** A stream message whose large `message` payload may have been summarized. */
export type SummarizedStreamMessage = Omit<StreamMessage, 'message'> & {
  message: string | TruncatedString;
};

export interface JobDiagnosis {
  workflow_id: string;
  app_id: string;
  status: 'running' | 'completed' | 'failed' | 'not_found';
  /**
   * Milliseconds since the last execution event. NOT a fault signal on its own —
   * a workflow can sit at a condition()/waitFor()/sleepFor() for days legitimately.
   * Read `findings` for the actual interpretation.
   */
  idle_for_ms: number | null;
  workflow_type: string | null;
  last_event_at: string | null;
  stream_summary: StreamSummary;
  escalation: EscalationSummary;
  findings: Finding[];
  /** Total events before any cap was applied (execution_events may be truncated to the most recent `maxEvents`). */
  total_events: number;
  events_truncated: boolean;
  /**
   * Full event timeline — present only when `include` contains `'events'` (or
   * `verbosity: 'full'`). Large string attributes are summarized to
   * `{ bytes, preview, truncated }`. Omitted by default to keep the verdict compact.
   */
  execution_events?: unknown[];
  /**
   * Raw engine + worker stream messages — present only when `include` contains
   * `'streams'` (or `verbosity: 'full'`). Large `message` payloads are summarized.
   * Omitted by default; see `raw_messages` for where to fetch the full payloads.
   */
  stream_messages?: { worker: SummarizedStreamMessage[]; engine: SummarizedStreamMessage[] };
  /** Pointer to `list_stream_messages` for the raw payloads (present when streams are omitted). */
  raw_messages?: RawMessagesHint;
}

/** Default cap on events returned in the payload — keeps a high-activity workflow from returning a huge response. */
const DEFAULT_MAX_EVENTS = 500;

/** Strings larger than this (UTF-8 bytes) are summarized rather than returned in full. */
const LARGE_STRING_BYTES = 1024;

/** How many leading characters of a summarized string to keep as a preview. */
const PREVIEW_CHARS = 200;

/** Recursion depth cap for summarizing nested event attributes. */
const SUMMARIZE_MAX_DEPTH = 6;

export type DiagnoseVerbosity = 'summary' | 'full';
export type DiagnoseSection = 'events' | 'streams';

export interface DiagnoseOptions {
  maxEvents?: number;
  /** Heavy sections to include in the response. Default: none (verdict only). */
  include?: DiagnoseSection[];
  /** Shorthand: `'full'` includes both events and streams; `'summary'` (default) includes neither. */
  verbosity?: DiagnoseVerbosity;
}

/** Replace an over-threshold string with a bounded summary; pass small strings through unchanged. */
function summarizeString(value: string): string | TruncatedString {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes <= LARGE_STRING_BYTES) return value;
  return { bytes, preview: value.slice(0, PREVIEW_CHARS), truncated: true };
}

/** Recursively summarize large string leaves in an event attribute tree (result/output/input/error payloads). */
function summarizeDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return summarizeString(value);
  if (value === null || typeof value !== 'object' || depth >= SUMMARIZE_MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => summarizeDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = summarizeDeep(v, depth + 1);
  }
  return out;
}

// ── diagnoseJob ──────────────────────────────────────────────────────────────

export async function diagnoseJob(
  workflowId: string,
  appId = 'durable',
  options: DiagnoseOptions = {},
): Promise<JobDiagnosis> {
  const pool = getPool();
  const maxEvents = Math.max(options.maxEvents ?? DEFAULT_MAX_EVENTS, 1);
  const includeEvents = options.verbosity === 'full' || !!options.include?.includes('events');
  const includeStreams = options.verbosity === 'full' || !!options.include?.includes('streams');

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
  const idleMs = status === 'running' && lastEventAt
    ? now - new Date(lastEventAt).getTime()
    : null;

  // Cap the events returned in the payload (keep the most recent) so a
  // high-activity workflow can't produce a huge response. Pattern matching
  // still runs over the full in-memory event set.
  const eventsTruncated = events.length > maxEvents;
  const cappedEvents = eventsTruncated ? events.slice(-maxEvents) : events;

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
    : [{ condition: 'export_unavailable', confidence: 0.9, severity: 'warning' as const, evidence: ['Execution export unavailable — job may have expired or HotMesh engine is not running'], guidance: [] }];

  const diagnosis: JobDiagnosis = {
    workflow_id: workflowId,
    app_id: appId,
    status,
    idle_for_ms: idleMs,
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
    total_events: events.length,
    events_truncated: eventsTruncated,
  };

  // Heavy sections are opt-in. Large string payloads are summarized either way
  // so an included section can't reintroduce the 100–200KB blow-up.
  if (includeEvents) {
    diagnosis.execution_events = cappedEvents.map((e) =>
      e && typeof e === 'object'
        ? { ...e, attributes: summarizeDeep((e as { attributes?: unknown }).attributes) }
        : e,
    );
  }
  if (includeStreams) {
    diagnosis.stream_messages = {
      worker: summarizeMessages(workerMessages),
      engine: summarizeMessages(engineMessages),
    };
  } else {
    diagnosis.raw_messages = {
      hint: 'Use list_stream_messages (Control Plane) filtered by jid (and aid/dad) for the full raw message payloads.',
      jid: workflowId,
    };
  }

  return diagnosis;
}

/** Summarize the large `message` payload of each stream message; everything else passes through. */
function summarizeMessages(messages: StreamMessage[]): SummarizedStreamMessage[] {
  return messages.map((m) => ({ ...m, message: summarizeString(m.message) }));
}

// ── findStalledJobs ──────────────────────────────────────────────────────────

export async function findStalledJobs(params: {
  appId?: string;
  idleMinutes?: number;
  workflowType?: string | null;
  limit?: number;
}): Promise<{ jobs: unknown[]; total: number }> {
  const appId = params.appId ?? 'durable';
  const idleMinutes = params.idleMinutes ?? 5;
  const limit = Math.min(params.limit ?? 50, 200);
  const keyPrefix = `hmsh:${appId}:j:`;

  // Fail loud: let a query error surface (the api layer maps it to a 500). A
  // silent empty result would hide a missing schema or a broken query.
  const pool = getPool();
  const { rows } = await pool.query(STALLED_JOBS(appId), [
    keyPrefix,
    String(idleMinutes),
    params.workflowType ?? null,
    limit,
  ]);

  return { jobs: rows, total: rows.length };
}

// ── findOrphanedSignals ──────────────────────────────────────────────────────

export async function findOrphanedSignals(params: {
  appId?: string;
  withinHours?: number;
  limit?: number;
}): Promise<{ orphans: unknown[]; total: number; within_hours: number }> {
  const appId = params.appId ?? 'durable';
  const withinHours = Math.min(Math.max(params.withinHours ?? 24, 1), 720);
  const limit = Math.min(params.limit ?? 100, 500);

  // Fail loud: let a query error surface (the api layer maps it to a 500). A
  // silent empty result would hide a missing schema or a broken query — exactly
  // what previously masked a JSON-operator bug on the text `message` column.
  const pool = getPool();
  const { rows } = await pool.query(ORPHANED_SIGNALS(appId), [String(withinHours), limit]);

  return { orphans: rows, total: rows.length, within_hours: withinHours };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function notFound(workflowId: string, appId: string): JobDiagnosis {
  return {
    workflow_id: workflowId,
    app_id: appId,
    status: 'not_found',
    idle_for_ms: null,
    workflow_type: null,
    last_event_at: null,
    stream_summary: { worker_total: 0, engine_total: 0, dead_lettered: 0, pending: 0, in_flight: 0 },
    escalation: { exists: false, id: null, status: null, signal_key: null, role: null, type: null, created_at: null },
    findings: [{ condition: 'not_found', confidence: 1, severity: 'critical', evidence: ['Workflow ID not found — no task record or job entity'], guidance: [] }],
    total_events: 0,
    events_truncated: false,
  };
}
