# Signal Queue

HotMesh 0.21.0 adds a native `hotmesh_signals` table and `client.signalQueue.*` API. Long Tail wraps these as `lt.signalQueue.*` and extends `conditionLT` to use them. The result is a single atomic operation that suspends a workflow and creates a signal queue row — removing a two-round-trip overhead from every human-in-the-loop escalation that uses the `conditionLT` pattern.

---

## What Changed

### Before: Two round-trips

```
1. createEscalation()         → INSERT lt_escalations row
2. enrichEscalationRouting()  → UPDATE lt_escalations SET metadata.signal_routing = { ... }
3. conditionLT(signalId)      → suspend workflow (no-op on the table)
```

Resolution:
```
4. resolveByMetadata()        → reads signal_routing from lt_escalations
5. handle.signal(signalId)    → delivers signal to workflow
6. ltResolveEscalation()      → UPDATE lt_escalations SET status = 'resolved'
```

### After: One atomic operation

```
1. createEscalation()         → INSERT lt_escalations (metadata.signal_id + signal_queue: true)
2. conditionLT(signalId, queueConfig)
                              → atomic: suspend workflow + INSERT hotmesh_signals row
```

Resolution:
```
3. resolveEscalation(id)      → client.signalQueue.resolve() marks resolved + signals workflow
                              → UPDATE lt_escalations SET status = 'resolved'
```

The `enrichEscalationRouting` call is eliminated. The suspension and the signal queue row are created atomically inside the HotMesh engine, so there is no race window between "workflow paused" and "signal route registered."

---

## Two-Table Architecture

| Table | Role | Owned by |
|-------|------|----------|
| `lt_escalations` | Business-layer record: display, audit, RBAC, forms | Long Tail |
| `hotmesh_signals` | Execution-layer record: signal routing, claim lifecycle | HotMesh engine |

The two tables are linked by `signal_id`. `lt_escalations.metadata.signal_id` holds the key; `hotmesh_signals.signalKey` holds the same value. Resolution updates both.

`lt_escalations` is always the source of truth for the dashboard, API queries, and RBAC checks. `hotmesh_signals` is always the source of truth for signal routing and the claim lifecycle. Do not bypass either.

---

## conditionLT with queueConfig

The existing `conditionLT(signalId)` call is unchanged. Pass an optional second argument to use the signal queue path:

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

**How it works internally:**

1. `conditionLT(signalId, queueConfig)` calls `Durable.workflow.condition(signalId, queueConfig)`.
2. The HotMesh engine atomically suspends the workflow and inserts a row into `hotmesh_signals` with the provided queue config.
3. The `hotmesh_signals` row is queryable via `lt.signalQueue.*` — it holds role, type, priority, metadata, and the signal key.
4. When `lt.escalations.resolve()` (or `lt.signalQueue.resolve()`) is called, it marks the `hotmesh_signals` row as resolved AND delivers the signal to the paused workflow in a single transaction.

**The `queueConfig` fields mirror `lt_escalations` fields** — role, type, subtype, priority, description, metadata, envelope. This redundancy is intentional: the signal queue is an execution-layer record; `lt_escalations` is the business-layer record with RBAC, audit trail, and dashboard visibility.

---

## Migration Pattern

### Before (boilerplate ortho:pipeline pattern)

```typescript
// activities.ts
export async function createStationEscalation(input: StepInput): Promise<string> {
  const esc = await EscalationService.createEscalation({ ... });
  await EscalationService.enrichEscalationRouting(esc.id, {
    signal_routing: { engine: 'durable', taskQueue, workflowType, workflowId, signalId },
  }, { workflowType, workflowId, taskQueue });
  return esc.id;
}

// station.ts
export async function myStation(envelope: LTEnvelope) {
  const signalId = `station-${ctx.workflowId}`;
  await createStationEscalation({ ..., signalId });
  const resolution = await conditionLT<StepResult>(signalId);   // Path B
  return { type: 'return' as const, data: resolution };
}
```

### After (signal queue pattern)

```typescript
// activities.ts — no enrichEscalationRouting
export async function createStationEscalation(input: StepInput): Promise<string> {
  const esc = await EscalationService.createEscalation({
    ...
    metadata: {
      signal_id: input.signalId,
      signal_queue: true,
      form_schema: { ... },
    },
  });
  return esc.id;
}

// station.ts
export async function myStation(envelope: LTEnvelope) {
  const signalId = `station-${ctx.workflowId}`;
  await createStationEscalation({ ..., signalId });

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
  });   // Path F

  return { type: 'return' as const, data: resolution };
}
```

The migration is additive — the `conditionLT` signature is backward-compatible. Existing workflows using `conditionLT(signalId)` without the second argument continue to work unchanged.

---

## Resolution Paths

| Path | When | How |
|------|------|-----|
| **B** — signal routing | `metadata.signal_id` set, no `signal_queue: true` | Reads `signal_routing` from `lt_escalations.metadata`, calls `handle.signal()` |
| **F** — signal queue | `metadata.signal_queue === true` | Calls `client.signalQueue.resolve()` — atomic mark-resolved + signal delivery |

Path F is preferred for new code. Path B remains for backward compatibility.

---

## Signal Queue Operations

The `lt.signalQueue` namespace exposes the full `hotmesh_signals` lifecycle.

### Claim and Resolve (Automation / Agent Pattern)

The typical agent pattern: find work by metadata, claim it, do the work, resolve.

```typescript
// 1. Claim an entry atomically by metadata
const claimed = await lt.signalQueue.claimByMetadata({
  key: 'stationName',
  value: 'scan',
  durationMinutes: 15,
});

if (!claimed.data?.ok) {
  // Nothing available
  return;
}

const { id, signalKey } = claimed.data;

// 2. Do the work ...

// 3. Resolve — marks hotmesh_signals resolved AND delivers signal to paused workflow
await lt.signalQueue.resolve({
  id,
  resolverPayload: { approved: true, scannedAt: new Date().toISOString() },
});
```

### List and Monitor

```typescript
const entries = await lt.signalQueue.list({
  role: 'reviewer',
  status: 'pending',
  limit: 25,
});
```

### Release an Expired Claim

```typescript
await lt.signalQueue.releaseExpired();
```

See [`lt.signalQueue` SDK reference](api/sdk/signal-queue.md) for the full method list.

---

## Defensive Resolution with tryResolveByMetadata

For downstream services that call `resolveByMetadata` programmatically (not via the dashboard), use `tryResolveByMetadata` instead. It returns a discriminated union rather than throwing or returning an HTTP-like error body, making it safe to use in conditional branches:

```typescript
const result = await lt.escalations.tryResolveByMetadata({
  key: 'orderId',
  value: 'order-123',
  resolverPayload: { approved: true },
});

if (result.matched) {
  // Escalation found and resolved (or signaled). Continue.
} else if (result.reason === 'not-found') {
  // No pending escalation with this key — safe to fall through.
} else {
  // result.reason === 'resolve-failed'
  // Something exists but resolution failed (DB error or signal delivery failure).
  // Do NOT silently continue — the workflow may be suspended waiting for a signal
  // that will never arrive.
  throw new Error(`Resolution failed for order ${orderId}`);
}
```

The critical distinction: `not-found` is safe to ignore; `resolve-failed` is not. A standard `resolveByMetadata` call collapses both into an error response, forcing callers to guess which case they're in.

---

## Working Example

See [`examples/workflows/signal-queue-station/`](../examples/workflows/signal-queue-station/) for a side-by-side comparison:

- `old-station.ts` — `enrichEscalationRouting` + `conditionLT(signalId)` (Path B)
- `new-station.ts` — `conditionLT(signalId, queueConfig)` (Path F), no `enrichEscalationRouting`
- `tests/workflows/signal-queue.test.ts` — integration test proving both paths produce the same resolved escalation

---

## Checklist

When migrating a station workflow to the signal queue pattern:

- [ ] Remove `enrichEscalationRouting` from the activity
- [ ] Add `signal_id: signalId` and `signal_queue: true` to `metadata` in `createEscalation`
- [ ] Change `conditionLT(signalId)` to `conditionLT(signalId, queueConfig)` in the workflow
- [ ] Populate `queueConfig` with role, type, subtype, priority, description, taskQueue, workflowType, metadata, envelope
- [ ] Verify resolution via `lt.escalations.resolve()` or `lt.signalQueue.resolve()` — both update both tables
- [ ] Do NOT remove `lt_escalations.status` from the escalation record — it is still the source of truth for the dashboard and RBAC
