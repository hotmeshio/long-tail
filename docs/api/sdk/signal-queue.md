# lt.signalQueue

Manage the HotMesh native signal queue (`hotmesh_signals` table). Signal queue entries are created automatically when a workflow calls `conditionLT(signalId, queueConfig)` — the engine suspends the workflow and inserts the row atomically.

This namespace is primarily used by agents and automation workflows that need to claim work items and deliver resolution signals without going through the escalation re-run path. For typical dashboard-driven HITL flows, `lt.escalations.resolve()` handles everything.

See the [Signal Queue guide](../../signal-queue.md) for architecture, migration patterns, and worked examples.

---

## list

List signal queue entries with optional filters.

```typescript
const result = await lt.signalQueue.list({
  role: 'reviewer',
  status: 'pending',
  limit: 25,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | No | Filter by role |
| `status` | `string` | No | Filter by status (`pending`, `claimed`, `resolved`) |
| `taskQueue` | `string` | No | Filter by task queue |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |

**Returns:** `SignalQueueEntry[]`

---

## get

Get a single signal queue entry by its UUID.

```typescript
const entry = await lt.signalQueue.get('sq-entry-uuid');
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Signal queue entry UUID |

**Returns:** `SignalQueueEntry`

---

## getBySignalKey

Find a signal queue entry by its signal key. Signal keys are the same value passed to `conditionLT` — typically `${workflowType}-${workflowId}` or a domain-specific key.

```typescript
const entry = await lt.signalQueue.getBySignalKey('approval-wf-abc123');
// null if not found
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signalKey` | `string` | Yes | The signal key used in `conditionLT` |

**Returns:** `SignalQueueEntry | null`

---

## claim

Claim a signal queue entry by its UUID. Sets `claimedBy` and `claimedUntil`.

```typescript
const result = await lt.signalQueue.claim({
  id: 'sq-entry-uuid',
  durationMinutes: 30,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Signal queue entry UUID |
| `durationMinutes` | `number` | No | Claim duration (default: 30) |

**Returns:** `ClaimSignalResult` — `{ ok: boolean; reason?: string }`

---

## claimByMetadata

Atomically find and claim the first available signal queue entry matching a metadata key-value pair. No polling needed — this is a single SQL operation.

```typescript
const result = await lt.signalQueue.claimByMetadata({
  key: 'stationName',
  value: 'scan',
  durationMinutes: 15,
});

if (result.ok) {
  const { id, signalKey } = result;
  // ... process work ...
  await lt.signalQueue.resolve({ id, resolverPayload: { scanned: true } });
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Metadata field name |
| `value` | `string` | Yes | Metadata field value |
| `durationMinutes` | `number` | No | Claim duration (default: 30) |

**Returns:** `ClaimSignalResult` — `{ ok: boolean; id?: string; signalKey?: string; reason?: 'not-found' | 'already-claimed' }`

---

## release

Release a claimed signal queue entry back to the pending pool.

```typescript
const result = await lt.signalQueue.release({ id: 'sq-entry-uuid' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Signal queue entry UUID |

**Returns:** `ReleaseSignalResult` — `{ ok: boolean; reason?: string }`

---

## resolve

Resolve a signal queue entry and deliver the signal to the paused workflow. This is atomic — the `hotmesh_signals` row is marked resolved AND the workflow receives the signal in a single Postgres transaction.

After calling this, also call `lt.escalations.resolve()` or update `lt_escalations.status` if you need the dashboard to reflect the resolved state. `lt.escalations.resolve()` does both automatically when called on a `signal_queue: true` escalation.

```typescript
const result = await lt.signalQueue.resolve({
  id: 'sq-entry-uuid',
  resolverPayload: { approved: true, notes: 'Looks good' },
});

if (result.ok) {
  // Signal delivered; workflow resumes with resolverPayload
} else if (result.reason === 'signal-failed') {
  // hotmesh_signals row updated but signal delivery failed
  // The workflow is still paused — handle the failure
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Signal queue entry UUID |
| `resolverPayload` | `object` | Yes | Payload delivered to the paused workflow |

**Returns:** `ResolveSignalResult` — `{ ok: boolean; signalKey?: string; reason?: 'not-found' | 'already-resolved' | 'signal-failed' }`

---

## resolveByMetadata

Find a signal queue entry by metadata and resolve it atomically. Equivalent to `claimByMetadata` + `resolve` in a single call.

```typescript
const result = await lt.signalQueue.resolveByMetadata({
  key: 'orderId',
  value: 'order-123',
  resolverPayload: { approved: true },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | `string` | Yes | Metadata field name |
| `value` | `string` | Yes | Metadata field value |
| `resolverPayload` | `object` | Yes | Payload delivered to the paused workflow |

**Returns:** `ResolveSignalResult`

---

## releaseExpired

Release all claimed signal queue entries whose `claimedUntil` timestamp has passed. Call this from a housekeeping cron or maintenance workflow to return stale claims to the available pool.

```typescript
const result = await lt.signalQueue.releaseExpired();
```

**Parameters:** None.

**Returns:** `ReleaseSignalResult` with a `count` of entries released.

---

## Types

Exported from `@hotmeshio/long-tail`:

```typescript
import type {
  SignalQueueEntry,
  ConditionQueueConfig,
  ClaimSignalResult,
  ReleaseSignalResult,
  ResolveSignalResult,
} from '@hotmeshio/long-tail';
```

### `SignalQueueEntry`

```typescript
interface SignalQueueEntry {
  id: string;
  signalKey: string;
  role?: string;
  type?: string;
  subtype?: string;
  priority?: number;
  description?: string;
  status: 'pending' | 'claimed' | 'resolved';
  taskQueue?: string;
  workflowType?: string;
  metadata?: Record<string, any>;
  envelope?: Record<string, any>;
  claimedBy?: string;
  claimedUntil?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

### `ConditionQueueConfig`

The second argument to `conditionLT`. All fields are optional but providing role, type, priority, taskQueue, and workflowType enables full filtering via `lt.signalQueue.list()`.

```typescript
interface ConditionQueueConfig {
  role?: string;
  type?: string;
  subtype?: string;
  priority?: number;
  description?: string;
  taskQueue?: string;
  workflowType?: string;
  metadata?: Record<string, any>;
  envelope?: Record<string, any>;
}
```
