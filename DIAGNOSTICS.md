# The System as Its Own Doctor

> PLAN.md was written from one incident. This document starts from what already
> exists: `exportWorkflowExecution()` and `getStreamMessages()` are both
> production APIs that the dashboard calls today. The diagnostic surface is
> composition of those two, plus one SQL query. Nothing needs to be invented at
> the data layer.

---

## The Two APIs That Already Contain Everything

### 1. `exportWorkflowExecution(workflowId, taskQueue, workflowName)`

The interpreted execution narrative. Reads from `engine_streams` and
`worker_streams` via the HotMesh SDK, inflates symbols, post-processes into a
causal timeline. Returns `WorkflowExecution`:

```
events[]:
  workflow_execution_started
  activity_task_scheduled
  activity_task_started
  activity_task_completed       ← result in attributes.result
  activity_task_failed          ← error in attributes.error
  child_workflow_execution_started
  signal_wait_started           ← entered a condition()/waitFor
  workflow_execution_signaled   ← condition resolved, duration_ms = wait time
  workflow_execution_completed
  workflow_execution_failed

summary: { total_events, total_duration_ms, activity_count, ... }
status: number
result: any
```

What it tells you: what happened, in what order, how long each step took,
whether a condition is open or resolved, whether any activity failed.

### 2. `getStreamMessages(schema, { jid, source, status, aid, ... })`

The forensic layer. Queries `engine_streams` and `worker_streams` directly,
returning every individual message that flowed through the system for a job.
This is what the dashboard Messages page shows — the user sees it filtered and
paginated; the diagnostic tool gets all of it.

`StreamMessage` fields:

```
id, source (engine|worker), stream_name, status (pending|claimed|processed|dead_lettered)
created_at, reserved_at, reserved_by, expired_at, dead_lettered_at
priority, visible_at, retry_attempt, max_retry_attempts
workflow_name, jid, aid, dad, msg_type, topic
message   ← full JSONB payload: every input, every output, queueConfig, signalId, metadata
```

Supports filtering by: `jid`, `aid`, `workflow_name`, `topic`, `status`, `msg_type`,
`stream_name`. Already used by the Messages dashboard. Parameterized, paginated, fast.

What it tells you: the exact payload of every message (including fields the export
doesn't surface), retry state, which engine/worker claimed it, when it went dead,
full timing lifecycle.

### The one SQL query

```sql
SELECT id, status, signal_key, role, type, assigned_to, created_at
FROM public.hmsh_escalations
WHERE workflow_id = $job_id
ORDER BY created_at DESC LIMIT 5;
```

This is the only direct SQL the per-job diagnostic needs. `hmsh_escalations` is
outside the HotMesh schema and not covered by either API above.

---

## What the Combination Reveals

`exportWorkflowExecution()` gives interpretation. `getStreamMessages({ jid })` gives
forensic detail. Aligned by `aid` (dimension path) + `execution_index`, they answer
every question:

| Question | Source |
|----------|--------|
| What activities ran and in what order? | export events |
| What did each activity return? | export `attributes.result` |
| Is there an open condition()? | export `signal_wait_started` with no completion |
| Was the full payload present in the worker result? | stream `message` JSONB |
| What is `queueConfig` / `signalId`? | stream message, `message->'data'` |
| Did any message exhaust retries? | stream `dead_lettered_at`, `retry_attempt` |
| Is a message claimed but not finished? | stream `reserved_at IS NOT NULL, expired_at IS NULL` |
| How long did each message wait in queue? | `reserved_at - created_at` |
| Which engine processed this step? | stream `reserved_by` |
| Is an escalation row missing? | `hmsh_escalations` query |

The level of detail available from stream messages is never fully shown in the
dashboard — field-level payload content, exact retry state, reservation timing.
The diagnostic MCP tool exposes all of it.

---

## `diagnoseJob` — Service Implementation

```typescript
async function diagnoseJob(
  workflowId: string,
  taskQueue: string,
  workflowName: string,
  appId = 'longtail',
): Promise<JobDiagnosis> {
  const schema = quoteSchema(appId);

  const [execution, engineMessages, workerMessages, escalation] = await Promise.all([
    exportWorkflowExecution(workflowId, taskQueue, workflowName),
    getStreamMessages(schema, { source: 'engine', jid: workflowId, limit: 100 }),
    getStreamMessages(schema, { source: 'worker', jid: workflowId, limit: 100 }),
    pool.query(ESCALATION_QUERY, [workflowId]),
  ]);

  const findings = matchPatterns(execution, workerMessages.messages, escalation.rows[0]);

  return {
    workflow_id: workflowId,
    status: deriveStatus(execution),
    stalled_for_ms: stalledMs(execution),
    timeline: execution.events,                 // full causal sequence
    stream_messages: {                           // forensic detail
      engine: engineMessages.messages,
      worker: workerMessages.messages,
    },
    escalation: escalation.rows[0] ?? null,
    findings,                                   // interpreted diagnosis
    recovery: findings.flatMap(f => f.treatment),
  };
}
```

`matchPatterns()` is a library of coded rules that look at the event stream and
stream message payloads together. Examples:

```
// Open signal with no escalation row
openSignals.length > 0 AND !escalation
  → condition: 'orphaned_signal'
  → evidence: [
      'signal_wait_started at <ts>, no workflow_execution_signaled',
      `worker message payload: queueConfig = ${queueConfig ?? 'ABSENT'}`,
      'No escalation row in hmsh_escalations',
    ]
  → treatment: [create_escalation_row, resolve_by_signal_key]

// Message dead-lettered
workerMessages.some(m => m.dead_lettered_at)
  → condition: 'dead_lettered_activity'
  → evidence: [`aid ${aid} dead-lettered after ${retry_attempt}/${max_retry_attempts} retries`]
  → treatment: [investigate_worker_health, retry_dead_lettered]

// Claimed message not completing
workerMessages.some(m => m.reserved_at && !m.expired_at && age(m) > 30_000)
  → condition: 'reservation_leak'
  → evidence: [`aid ${aid} claimed by ${reserved_by} at ${reserved_at}, still open after ${age}ms`]
  → treatment: [check_worker_health]

// Escalation row exists and pending — normal
escalation?.status === 'pending' AND openSignals.length > 0
  → condition: 'normal_wait'
  → severity: 'info'
  → evidence: ['Workflow suspended at condition(), escalation row exists']
```

The patterns are general — they match on event types and message field presence,
not on workflow-specific activity names. Any workflow type gets diagnosis for free.

---

## The MCP Tool Surface

### Per-job tools (build on existing APIs)

| Tool | Composition | Purpose |
|------|-------------|---------|
| `diagnose_job` | export + getStreamMessages + 1 SQL | Interpreted diagnosis with findings + treatment |
| `get_job_messages` | getStreamMessages({ jid }) | Raw stream messages for a job — full payload, retries, timing |
| `trace_execution` | exportWorkflowExecution | Chronological event narrative, no interpretation |

`get_job_messages` is the dashboard Messages page filtered to a single job,
exposed to LLMs. It surfaces everything the dashboard shows in the detail panel
(payload, retry count, reserved_by, timing) for the entire job at once.

### Fleet tools (direct SQL)

| Tool | Purpose |
|------|---------|
| `get_system_health` | Throughput, queue pressure, pre-computed anomalies |
| `find_stalled_jobs` | Running jobs with no recent progress |
| `find_orphaned_signals` | Suspended jobs with no escalation row |

Fleet tools find candidates. Per-job tools explain them.

### Recovery tools

| Tool | Purpose |
|------|---------|
| `recover_job` | Single job: create missing escalation row + signal (dry_run gate) |
| `auto_recover_orphaned` | Bulk: superadmin, dry_run: true default |
| `verify_recovery` | Re-export after recovery, confirm job resumed |

---

## The LLM Journey

```
User: "Some printer jobs are stuck"

LLM: get_system_health()
← anomalies: [{ kind: 'orphaned_signals', count: 84, next_tool: 'find_orphaned_signals()' }]

LLM: find_orphaned_signals()
← 84 jobs, all within a 12-minute window

LLM: diagnose_job(first_job_id, ...)
← findings: [{
    condition: 'orphaned_signal',
    confidence: 0.98,
    evidence: [
      'signal_wait_started at 14:23:01, no completion',
      'worker message payload: queueConfig = ABSENT (pre-0.22 SDK)',
      'No row in hmsh_escalations',
    ],
    treatment: [create_escalation_row, resolve_by_signal_key]
  }]
← stream_messages.worker: [{ aid: '0/0/0/worker', message: { data: { signalId: '...', queueConfig: null } }, ... }]

LLM: "I know exactly what happened. During a rolling upgrade, 84 jobs ran on
      pre-0.22 SDK workers that didn't return queueConfig. The escalation INSERT
      was skipped. Each job is suspended with an open signal and no resolution
      path. I can recover all 84 — here's the plan."

[dry_run=true] auto_recover_orphaned() → plan for 84 jobs
User: "Do it."
[dry_run=false] auto_recover_orphaned() → recovered: 84

LLM: verify_recovery(sample_ids) → all resumed
```

Five tool calls. Under three minutes.

---

## Phase Plan

### Phase 1 — Per-job diagnosis

`services/diagnostics/index.ts`
- `diagnoseJob()` — compose `exportWorkflowExecution` + `getStreamMessages` + `ESCALATION_QUERY`
- `matchPatterns()` — coded finding library

`services/diagnostics/patterns.ts`
- The `Finding` pattern library: orphaned_signal, dead_lettered_activity,
  reservation_leak, normal_wait, terminal_failure, never_started

`system/mcp-servers/admin/diagnostics.ts`
- `diagnose_job`, `get_job_messages`, `trace_execution`

`routes/diagnostics.ts`
- `GET /api/jobs/:id/diagnose`
- `GET /api/jobs/:id/messages` (proxy to getStreamMessages filtered by jid)

`tests/services/diagnostics/` — unit tests for each pattern in matchPatterns()

### Phase 2 — Recovery

`services/diagnostics/recovery.ts`
- `recoverJob`, `autoRecoverOrphaned`, `verifyRecovery`

MCP: `recover_job`, `auto_recover_orphaned`, `verify_recovery`

REST: `POST /api/jobs/:id/recover`, `POST /api/jobs/recover-orphaned`

### Phase 3 — Fleet vitals + proactive health

`services/diagnostics/health.ts`
- `getSystemHealth()` — throughput, queue pressure, anomalies[]
- `findStalledJobs()`, `findOrphanedSignals()`

MCP: `get_system_health`, `find_stalled_jobs`, `find_orphaned_signals`

WebSocket event `system.health` → dashboard badge (stalled/orphan count)

### Phase 4 — HotMesh SDK (owned)

General engine lifecycle events (`job:stalled`, `message:dead_lettered`) added to
the SDK — not activity-type-specific. Long Tail registers listeners. Fleet SQL
queries become verification, not primary detection. Anomalies surface in
milliseconds rather than on the next cron tick.

---

## Why This Is First-Class

The data is already there. `getStreamMessages` and `exportWorkflowExecution` are
production APIs powering the dashboard today. The level of detail in a single
stream message — full JSONB payload, retry state, reservation timing, activity
dimension path — is richer than anything currently surfaced to an LLM.

The diagnostic MCP tools are not a new data layer. They are a composition surface
that aligns what the dashboard shows humans with what an LLM needs to reason and
act. The same APIs, different consumer, full depth.
