import type { WorkflowExecution } from '@hotmeshio/hotmesh/build/types/exporter';

import type { StreamMessage } from '../controlplane/types';

export interface Finding {
  condition: string;
  confidence: number;
  severity: 'critical' | 'warning' | 'info';
  evidence: string[];
  treatment: RecoveryOption[];
}

export interface RecoveryOption {
  action: string;
  note: string;
  [key: string]: unknown;
}

/**
 * Match event stream + stream messages against known failure patterns.
 * Returns findings ordered by severity (critical first).
 */
export function matchPatterns(
  execution: WorkflowExecution,
  workerMessages: StreamMessage[],
  engineMessages: StreamMessage[],
  escalationRow: Record<string, unknown> | null,
): Finding[] {
  const findings: Finding[] = [];
  const events = execution.events ?? [];
  const now = Date.now();

  // ── Derive open signals ──────────────────────────────────────────────────
  const signalCompletions = new Set(
    events
      .filter(e => e.event_type === 'workflow_execution_signaled')
      .map(e => (e.attributes as any).timeline_key as string)
      .filter(Boolean),
  );
  const openSignals = events.filter(
    e => (e.event_type as string) === 'signal_wait_started' &&
      !signalCompletions.has((e.attributes as any).timeline_key),
  );

  // ── Dead-lettered messages ────────────────────────────────────────────────
  const deadWorker = workerMessages.filter(m => m.dead_lettered_at);
  const deadEngine = engineMessages.filter(m => m.dead_lettered_at);

  // ── Reservation leaks: claimed but not ACK'd for > 30s ───────────────────
  const leaks = workerMessages.filter(m =>
    m.reserved_at && !m.expired_at && !m.dead_lettered_at &&
    now - new Date(m.reserved_at).getTime() > 30_000,
  );

  // ── Pattern: orphaned_signal ──────────────────────────────────────────────
  if (openSignals.length > 0 && !escalationRow) {
    const workerMsg = workerMessages.find(m => m.expired_at && m.aid?.endsWith('/worker'));
    const payload = safeParseJson(workerMsg?.message);
    const queueConfig = payload?.data?.queueConfig;
    const signalId = payload?.data?.signalId as string | undefined;

    findings.push({
      condition: 'orphaned_signal',
      confidence: 0.98,
      severity: 'critical',
      evidence: [
        `${openSignals.length} open signal(s) with no matching resolution`,
        `No escalation row in hmsh_escalations for this workflow`,
        queueConfig == null
          ? `Worker result missing queueConfig — escalation INSERT was skipped (pre-0.22 SDK)`
          : `Worker result has queueConfig but escalation INSERT did not complete`,
        ...(signalId ? [`Signal key: ${signalId}`] : []),
      ],
      treatment: [
        { action: 'create_escalation_row', note: 'INSERT missing row into public.hmsh_escalations' },
        ...(signalId ? [{ action: 'resolve_by_signal_key', signal_key: signalId, note: 'POST /api/escalations/resolve-by-signal-key after inserting escalation row' }] : []),
      ],
    });
  }

  // ── Pattern: normal_wait ──────────────────────────────────────────────────
  // Two paths reach here:
  // 1. Open signal in event stream (signal_wait_started) + pending escalation
  // 2. No terminal event + pending escalation (conditionLT path — no signal_wait_started in export)
  const isRunning = !events.some(e =>
    e.event_type === 'workflow_execution_completed' || e.event_type === 'workflow_execution_failed',
  );
  const isNormalWait =
    (openSignals.length > 0 && escalationRow?.status === 'pending') ||
    (isRunning && events.length > 0 && escalationRow?.status === 'pending');

  if (isNormalWait) {
    findings.push({
      condition: 'normal_wait',
      confidence: 0.99,
      severity: 'info',
      evidence: [
        `Workflow suspended — escalation exists (status: pending)`,
        ...(escalationRow!.role ? [`Role: ${escalationRow!.role}, Type: ${escalationRow!.type}`] : []),
        ...(escalationRow!.id ? [`Escalation id: ${escalationRow!.id}`] : []),
      ],
      treatment: [{ action: 'none', note: 'Waiting for human to claim and resolve escalation' }],
    });
  }

  // ── Pattern: dead_lettered_activity ──────────────────────────────────────
  if (deadWorker.length > 0 || deadEngine.length > 0) {
    const samples = [...deadWorker, ...deadEngine].slice(0, 3);
    findings.push({
      condition: 'dead_lettered_activity',
      confidence: 0.99,
      severity: 'critical',
      evidence: [
        `${deadWorker.length} worker message(s) dead-lettered, ${deadEngine.length} engine message(s) dead-lettered`,
        ...samples.map(m =>
          `aid: ${m.aid ?? 'engine'}, retries: ${m.retry_attempt}/${m.max_retry_attempts}, stream: ${m.stream_name}`,
        ),
      ],
      treatment: [{
        action: 'investigate_dead_letter',
        count: deadWorker.length + deadEngine.length,
        note: 'Message exhausted retries — check worker health and DB connectivity',
      }],
    });
  }

  // ── Pattern: reservation_leak ─────────────────────────────────────────────
  if (leaks.length > 0) {
    findings.push({
      condition: 'reservation_leak',
      confidence: 0.85,
      severity: 'warning',
      evidence: leaks.map(m =>
        `aid: ${m.aid}, claimed by: ${m.reserved_by ?? 'unknown'}, open for ${Math.round((now - new Date(m.reserved_at!).getTime()) / 1000)}s`,
      ),
      treatment: [{ action: 'check_worker_health', note: 'Worker claimed message but never ACKd — check for crashed workers' }],
    });
  }

  // ── Pattern: terminal_failure ─────────────────────────────────────────────
  const lastEvent = events.at(-1);
  if (lastEvent?.event_type === 'workflow_execution_failed') {
    const attrs = lastEvent.attributes as any;
    findings.push({
      condition: 'terminal_failure',
      confidence: 0.99,
      severity: 'critical',
      evidence: [
        `Workflow terminated with failure`,
        ...(attrs?.error ? [`Error: ${attrs.error}`] : []),
      ],
      treatment: [{ action: 'none', note: 'Workflow terminated — review error and restart if needed' }],
    });
  }

  // ── Pattern: never_started ────────────────────────────────────────────────
  const nonStartEvents = events.filter(e => e.event_type !== 'workflow_execution_started');
  if (events.length > 0 && nonStartEvents.length === 0) {
    findings.push({
      condition: 'never_started',
      confidence: 0.90,
      severity: 'critical',
      evidence: [`Workflow created but no activities have run — engine may not be consuming this stream`],
      treatment: [{ action: 'check_engine_health', note: 'Check engine health and stream backlog for this workflow type' }],
    });
  }

  // ── Default: healthy ──────────────────────────────────────────────────────
  if (findings.length === 0) {
    const isCompleted = events.some(e =>
      e.event_type === 'workflow_execution_completed' || e.event_type === 'workflow_execution_failed',
    );
    findings.push({
      condition: isCompleted ? 'completed' : 'running',
      confidence: 0.95,
      severity: 'info',
      evidence: [isCompleted ? 'Workflow completed normally' : 'Workflow is running — no anomalies detected'],
      treatment: [{ action: 'none', note: 'No intervention required' }],
    });
  }

  // Critical first
  const order = { critical: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

function safeParseJson(raw: string | undefined | null): Record<string, any> | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
