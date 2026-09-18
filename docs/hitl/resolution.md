# Resolution

## Claim Lifecycle

A claim is a **work lock**: `assigned_to` names the holder and `assigned_until` bounds the window. The lock exists only while the window is active — this is what `isEffectivelyClaimed` means throughout the platform. Two related shapes use the same columns without being locks:

- **Unclaimed** (`assigned_to` null) — available to the whole role queue, and resolvable by system code.
- **Durable pre-assignment** (`assigned_to` set, no window) — a workflow targeting a named user (the one-time-user JIT-form shape, see [roles.md](roles.md#one-time-and-pre-assigned-escalations)). Routing, not a lock.

### Claiming and extending

Claiming takes a duration (configurable options via `LT_CLAIM_DURATION_OPTIONS`; a custom duration is always available). Re-claiming a row you already hold extends the window — the claim endpoint is idempotent per assignee and reports `isExtension: true`.

In the dashboard, 90 seconds before the window lapses a **Claim Expiring** dialog offers the same duration options to extend. Dismissing it lets the window run out: at expiry the form locks, the action bar returns to its claim state, and the item is available to the queue again. Typed input survives — see draft persistence in [form.md](form.md#draft-persistence) — so re-claiming picks up exactly where the resolver left off.

### The claim-liveness rule

A resolve presented **by escalation id** must not act against a claim lock. The rule blocks exactly two states:

| Row state | Resolve by id |
|-----------|---------------|
| Unclaimed | Allowed (system resolvers act on unclaimed rows by design) |
| Durable pre-assignment (no window) | Allowed |
| Live window, held by the caller | Allowed |
| Live window, held by someone else | **409** — the lock is theirs |
| Caller's own window, lapsed | **409** — stale work; re-claim to resolve |
| Someone else's window, lapsed | Allowed — the lock is gone, the row is back in the pool |

The rule applies to every principal, including superadmins: the claim is a work lock, not an authorization scope. It is enforced twice — an advisory check before any resolution side effects fire, and atomically inside the SDK's guarded resolve UPDATE (`assertClaim`), so a claim that lapses mid-request still cannot land a stale resolution.

`resolveBySignalKey` and `resolveByMetadata` are claim-agnostic: they are system ingress surfaces (webhooks, domain events) that resolve on behalf of the process, not a claimant.

---

## Resolving from System Code

When a backend service (not the dashboard UI) needs to resolve an escalation — for example, an ingress handler that receives a webhook or processes a domain event — use the escalation SDK methods directly.

### By escalation ID

Use when you already have the escalation UUID (e.g. stored in your own DB alongside the order):

```typescript
const result = await lt.escalations.resolve({
  id: escalationId,
  resolverPayload: { approved: true, targetStatus: 'ready' },
});
```

This routes through the full resolution path for all escalation types.

### By metadata key-value pair

Use when you know a domain identifier (e.g. `orderId`) but not the escalation UUID. `resolveByMetadata` finds the highest-priority pending escalation matching the key-value pair and resolves it atomically — no pre-flight lookup, no TOCTOU:

```typescript
const result = await lt.escalations.resolveByMetadata({
  key: 'orderId',
  value: orderId,
  resolverPayload: { approved: true, targetStatus: 'ready' },
});

if (result.status === 404) {
  // No pending escalation for this orderId
}
```

### By signal key

When the signal key is deterministic and known to the caller (e.g. `station-done-${workflowId}`), use the signal-key path to skip the metadata lookup:

```typescript
await lt.escalations.resolveBySignalKey({
  signalKey: `station-done-${workflowId}`,
  resolverPayload: { approved: true },
});
```

### Batch items

A batch escalation (a `conditional` wait declared with `batch: [...]` — see [Creating Escalations](escalation.md)) collects one submission per declared item key. Submit each item by id or by metadata facet:

```typescript
const first = await lt.escalations.resolveBatchItem({
  id: escalationId,
  itemKey: 'weld',
  resolverPayload: { ok: true, notes: 'weld complete' },
});
// → { outcome: 'accepted', remaining: 2, escalationId }

const second = await lt.escalations.resolveBatchItemBySignalKey({
  signalKey: homeSignalId,           // the deterministic id the parent parked on
  itemKey: 'weld',
  resolverPayload: { ok: true },
});

const last = await lt.escalations.resolveBatchItemByMetadata({
  key: 'orderId',
  value: orderId,
  itemKey: 'paint',
  resolverPayload: { ok: true },
});
// → { outcome: 'completed', remaining: 0, signaled: true, workflowId }
```

Interim items return `accepted` with the remaining count and publish `escalation.updated` (progress rides `metadata.batch_pending`/`batch_count`); the LAST item returns `completed` — the row resolved with the assembled collection as `resolver_payload` and the workflow woke with it, in the same statement. Duplicate submissions return 409 (`duplicate-item`, safe under webhook retries); undeclared keys return 400.

Each item validates against the same versioned role form a single-item resolve uses, canonical 422 included. Batch fills are claim-agnostic — a batch collects contributions from multiple principals, the same rationale as the signal-key path — while `assertClaim: true` (by-id form) opts into the caller's own live-claim assertion inside the guarded statement.

Item keys are non-empty strings up to 128 characters; prefer URL-friendly names (`u1-L`). Payload keys inside each item are caller-owned — the platform reserves no names inside `batch_items` values. Every fill stamps `envelope.batch_filled_at[itemKey]` with the database clock in the same statement, so the row carries the collection timeline as row truth. After an SLA expiry (`conditional` returns `false`) the terminal row retains the partial `batch_items` and their timestamps — read them back with `GET /api/escalations/:id` or `getEscalationBySignalKey` from an activity.

### Accumulator items

An accumulator escalation (a `conditionalAccumulator` wait declared with `accumulate: {...}`, see [Creating Escalations](escalation.md#open-accumulation--items-arrive-over-time)) holds items added over time. Add by id, by signal key, or by metadata facet:

```typescript
const first = await lt.escalations.accumulate({
  id: binId,
  itemKey: orderId,
  payload: { weight: 2 },                  // optional; validates against the bin role's form
  reciprocal: { id: bagEscalationId },     // optional; the bag's own row is written in the same statement
});
// → { outcome: 'accepted', count: 1, remaining: 11, escalationId,
//     reciprocal: { outcome: 'completed', count: 1, escalationId, signaled: true } }

const second = await lt.escalations.accumulateBySignalKey({
  signalKey: homeSignalId,
  itemKey: 'order-2',
});

const last = await lt.escalations.accumulateByMetadata({
  key: 'binKey',
  value: binKey,
  itemKey: 'order-12',
});
// → { outcome: 'completed', count: 12, remaining: 0, signaled: true, workflowId }

await lt.escalations.removeItem({ id: binId, itemKey: 'order-2' });
// → { outcome: 'removed', count: 11, escalationId }

const held = await lt.escalations.getItems({ id: binId });
// → { kind: 'accumulate', count, max, items: [{ itemKey, payload?, at, actor?, reciprocalId? }, ...] }
```

Interim adds return `accepted` with the count held and the slots remaining (`null` when unbounded) and publish `escalation.updated` carrying `item_key`, `count`, `actor`, and `reciprocal_id`; the add that reaches `max` returns `completed`, the row resolved with `{ $accumulated, $trigger: 'count' }` as `resolver_payload` and the workflow woke with it, in the same statement. A key already held returns 409 (`duplicate-item`, safe under scanner double-reads); a full cap returns 409 (`full`); a row that is not an accumulator returns 400. Removals return the new count, publish `escalation.updated` with `removed: true`, and never wake the waiter.

Adds are claim-agnostic, the same rationale as batch fills: a container collects contributions from many hands. `assertClaim: true` (by-id form) opts into the caller's own live-claim assertion inside the guarded statement. Every add records the actor on the entry and merges `resolved_by` into the row's metadata, so the completing add's stamp is the resolution provenance and `$resolution` rides the completing wake.

A reciprocal names a second row by `id`, `signalKey`, or `key`/`value`; it is RBAC-gated before the statement (404 when the caller cannot see it, 403 when they see it but cannot act on it) and written in the same statement as the container, both or neither. The reciprocal row holds the container's id as its item key; a member declared `accumulate: { max: 1 }` completes and wakes on that add. When the reciprocal blocks the add, the response names why (`reciprocal-full`, `reciprocal-duplicate`, `reciprocal-terminal`, `reciprocal-not-accumulator`) and the container is untouched.

Item keys are non-empty strings up to 128 characters. Reserved accumulate keys (`accumulate_count`, `accumulate_max`, `accumulate_keys`) cannot appear in the `metadata` patch. A plain `resolve` on an accumulator row is the hand-close: the workflow receives the collection merged with the resolver payload under `$trigger: 'resolve'`, and the row stores the same. After the window closes the row is `expired` with the collection stored as `resolver_payload`, exactly what the workflow received.

### Resolving a set atomically

When one decision settles a set of waits — each with its own payload — use `resolveAllOrNone`:

```typescript
await lt.escalations.resolveAllOrNone({ items: [
  { id: 'esc-aaa', resolverPayload: { decision: 'approve' } },
  { id: 'esc-bbb', resolverPayload: { decision: 'reject' } },
] });
```

Every listed row resolves with its own payload in one SQL statement, waking each parked workflow with its own value — or nothing resolves. A 409 names exactly the rows that blocked (`failedIds` + reasons). Pass `requireClaimed: true` to assert, inside the same statement, that every row is still assigned to the caller. See the [SDK reference](../api/sdk/escalations.md#resolveallornone) for the full contract.

---

## Recording the Outcome

An escalation row carries **intent** — what was asked, who it routed to. Resolving it stamps the **outcome** onto the same row: every resolve surface takes an optional `metadata` patch merged into the row's GIN-indexed metadata.

| Surface | How to pass it |
|---------|----------------|
| HTTP | `metadata` in the resolve body (`POST /api/escalations/:id/resolve`) |
| SDK facade | `lt.escalations.resolve({ id, resolverPayload, metadata })` |
| MCP | `metadata` arg on `claim_and_resolve` / `resolve_escalation` |
| In-process library | `resolveEscalation(id, payload, metadata)` |

```typescript
await lt.escalations.resolve({
  id,
  resolverPayload: { approved: true },               // resumes the workflow; not indexed
  metadata: { outcome: 'approved', reviewedBy: 'alice', durationMs: elapsed },
});
```

The metadata patch is the durable, queryable record on the row. The resolver payload resumes the paused workflow and is not indexed separately. Use the metadata patch for audit trail and analytics — disposition, reviewer, time-to-resolve — so the escalation table answers *what was asked, what was decided, and how long it took* without a parallel log.

---

## Cancelling Escalations

Cancellation is terminal — a cancelled escalation cannot be re-opened.

### When cancellation happens

- **Workflow termination** — `POST /api/workflows/:workflowId/terminate` automatically cancels any pending escalations tied to it. The waiting `conditional` call returns `null`.
- **Explicit cancel** — cancel a single escalation via the API or from the dashboard. Any workflow waiting on that escalation via `conditional` receives `null`.

### API

```
POST /api/escalations/:id/cancel        # single
POST /api/escalations/bulk-cancel       # { "ids": [...] }
```

Returns 409 if the escalation is already resolved or cancelled.

### Dashboard

- **Escalations list** — select one or more rows and click **Cancel** in the bulk action bar.
- **Escalation detail page** — a Cancel link appears in the action bar when the escalation is in `available` or `claimed_by_me` state.

### Handling cancellation in workflows

`conditional` returns `T | false | null`. Always guard before accessing the payload:

```typescript
const decision = await conditional<{ approved: boolean }>(signalId, escalationConfig);

if (decision === null) {
  // Escalation was cancelled
  return { type: 'return' as const, data: { cancelled: true } };
}
if (decision === false) {
  // Escalation timed out (SLA)
  return { type: 'return' as const, data: { timedOut: true } };
}

// Normal path — decision is the resolver's payload
if (decision.approved) { ... }
```

The `!decision` shorthand handles both cases when you don't need to distinguish between them:

```typescript
if (!decision) {
  return { type: 'return' as const, data: { cancelled: true } };
}
```
