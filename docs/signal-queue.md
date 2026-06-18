# Signal Queue

The signal queue is a native HotMesh execution primitive (`hotmesh_signals` table) that suspends a workflow and registers a signal route in one atomic database operation. Long Tail exposes it as `lt.signalQueue.*` and integrates it into `conditionLT` via an optional second argument.

---

## Architecture

Two tables underlie every signal-backed HITL escalation:

| Table | Role | Owned by |
|-------|------|----------|
| `lt_escalations` | Business-layer record: display, audit, RBAC, forms | Long Tail |
| `hotmesh_signals` | Execution-layer record: signal routing, claim lifecycle | HotMesh engine |

The tables are linked by `signal_id`. `lt_escalations.metadata.signal_id` holds the key; `hotmesh_signals.signalKey` holds the same value. `lt_escalations` is the source of truth for the dashboard, API queries, and RBAC checks. `hotmesh_signals` is the source of truth for signal routing and the claim lifecycle. Resolution updates both.

---

## conditionLT with queueConfig

`conditionLT(signalId, queueConfig)` suspends the workflow and creates a `hotmesh_signals` row in a single atomic transaction. The paused workflow is immediately discoverable via `lt.signalQueue.*` using any of the metadata fields from `queueConfig`.

```typescript
import { conditionLT } from '@hotmeshio/long-tail';
import type { ConditionQueueConfig } from '@hotmeshio/long-tail';

const resolution = await conditionLT<{ approved: boolean; notes: string }>(signalId, {
  role: 'reviewer',
  type: 'approval',
  subtype: 'budget-request',
  priority: 2,
  description: 'Budget approval needed',
  taskQueue: ctx.taskQueue,
  workflowType: 'approvalWorkflow',
  metadata: { orderId: envelope.data.orderId },
  envelope: { station: 'budget-review' },
});
```

When `lt.escalations.resolve()` or `lt.signalQueue.resolve()` is called, it marks the `hotmesh_signals` row as resolved AND delivers the signal to the paused workflow in a single transaction. No separate signal delivery step needed.

The `queueConfig` fields (role, type, subtype, priority, description, metadata, envelope) mirror `lt_escalations` fields. This is intentional: the signal queue entry holds the execution-layer routing info; the escalation record holds the business-layer audit trail, RBAC scope, and dashboard display.

Calling `conditionLT(signalId)` without the second argument continues to work — the behavior is unchanged.

---

## Writing a Signal-Queue Station Workflow

The activity creates the `lt_escalations` record with `signal_id` and `signal_queue: true`. The workflow suspends atomically via `conditionLT`.

```typescript
// activities.ts
export async function createStationEscalation(input: StepInput): Promise<string> {
  const esc = await EscalationService.createEscalation({
    type: 'station',
    subtype: input.stationName,
    description: input.instructions,
    role: input.role,
    priority: 2,
    workflow_id: input.workflowId,
    task_queue: input.taskQueue,
    workflow_type: input.workflowType,
    metadata: {
      signal_id: input.signalId,   // links lt_escalations to hotmesh_signals
      signal_queue: true,          // tells resolve to use Path F
      form_schema: { ... },
    },
    envelope: JSON.stringify(input.envelope),
  });
  return esc.id;
}

// station.ts
export async function myStation(envelope: LTEnvelope) {
  const ctx = Durable.workflow.workflowInfo();
  const signalId = `station-${ctx.workflowId}`;

  const activities = Durable.workflow.proxyActivities<ActivitiesType>({
    activities: stationActivities,
    taskQueue: ctx.taskQueue,
    retry: { maximumAttempts: 3 },
  });

  await activities.createStationEscalation({
    role: envelope.data.role,
    stationName: envelope.data.stationName,
    instructions: envelope.data.instructions,
    workflowId: ctx.workflowId,
    taskQueue: ctx.taskQueue,
    workflowType: ctx.workflowName,
    signalId,
    envelope,
  });

  const resolution = await conditionLT<StepResult>(signalId, {
    role: envelope.data.role,
    type: 'station',
    subtype: envelope.data.stationName,
    priority: 2,
    description: envelope.data.instructions,
    taskQueue: ctx.taskQueue,
    workflowType: ctx.workflowName,
    metadata: { stationName: envelope.data.stationName, workflowId: ctx.workflowId },
    envelope: { station: envelope.data.stationName },
  });

  return { type: 'return' as const, data: resolution };
}
```

---

## Resolution Paths

`lt.escalations.resolve()` inspects `metadata.signal_queue` to choose the resolution path automatically:

| Path | Condition | Behavior |
|------|-----------|----------|
| **B** — signal routing | `metadata.signal_id` set, no `signal_queue: true` | Reads `signal_routing` from `lt_escalations.metadata`, calls `handle.signal()` |
| **F** — signal queue | `metadata.signal_queue === true` | Calls `client.signalQueue.resolve()` — atomic mark-resolved + signal delivery |

No caller changes required. Pass the escalation ID to `lt.escalations.resolve()` and the correct path is selected.

---

## Signal Queue Operations

`lt.signalQueue` exposes the full `hotmesh_signals` lifecycle — useful for agents, automation workflows, and queue management tasks.

### Claim and Resolve (Agent Pattern)

```typescript
// Find and claim an entry by metadata
const claimed = await lt.signalQueue.claimByMetadata({
  key: 'stationName',
  value: 'scan',
  durationMinutes: 15,
});

if (!claimed.ok) return;  // Nothing available

// ... do the work ...

// Deliver signal atomically — marks hotmesh_signals resolved + unblocks workflow
await lt.signalQueue.resolve({
  id: claimed.id,
  resolverPayload: { approved: true, scannedAt: new Date().toISOString() },
});
```

### List and Monitor

```typescript
const entries = await lt.signalQueue.list({ role: 'reviewer', status: 'pending', limit: 25 });
```

### Release Expired Claims

```typescript
await lt.signalQueue.releaseExpired();
```

See [`lt.signalQueue` SDK reference](api/sdk/signal-queue.md) for the full method list.

---

## Defensive Resolution with tryResolveByMetadata

For services that resolve escalations programmatically, use `tryResolveByMetadata` instead of `resolveByMetadata`. It returns a discriminated union that distinguishes "no pending escalation found" (safe to skip) from "resolution failed" (should not be skipped silently):

```typescript
const result = await lt.escalations.tryResolveByMetadata({
  key: 'orderId',
  value: 'order-123',
  resolverPayload: { approved: true },
});

if (result.matched) {
  // Resolved. Continue.
} else if (result.reason === 'not-found') {
  // No pending escalation — safe to fall through.
} else {
  // result.reason === 'resolve-failed'
  // Resolution or signal delivery failed. Do NOT silently continue —
  // a workflow may be suspended waiting on a signal that will never arrive.
  throw new Error(`Resolution failed for order ${orderId}`);
}
```

See [lt.escalations SDK reference](api/sdk/escalations.md#tryresolvebymetadata) for full parameter and type docs.

---

## Working Example

[`examples/workflows/signal-queue-station/`](../examples/workflows/signal-queue-station/) ships two station implementations side by side:

- `old-station.ts` — uses `enrichEscalationRouting` + `conditionLT(signalId)` (Path B)
- `new-station.ts` — uses `conditionLT(signalId, queueConfig)`, no `enrichEscalationRouting` (Path F)
- `tests/workflows/signal-queue.test.ts` — integration test verifying both paths resolve to the same escalation status

---

## Updating Existing Workflows

If you have an existing station workflow that calls `enrichEscalationRouting`:

- [ ] Remove `enrichEscalationRouting` from the activity
- [ ] Add `signal_id: signalId` and `signal_queue: true` to `metadata` when calling `createEscalation`
- [ ] Change `conditionLT(signalId)` to `conditionLT(signalId, queueConfig)` in the workflow
- [ ] Populate `queueConfig` with role, type, subtype, priority, description, taskQueue, workflowType, metadata, envelope
- [ ] `lt.escalations.resolve()` and `lt.signalQueue.resolve()` both update both tables — use either for resolution
