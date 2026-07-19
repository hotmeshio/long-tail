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

- **Workflow termination** — `POST /api/workflows/:workflowId/terminate` automatically cancels any pending escalations tied to it. The waiting `conditionLT` call returns `null`.
- **Explicit cancel** — cancel a single escalation via the API or from the dashboard. Any workflow waiting on that escalation via `conditionLT` receives `null`.

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

`conditionLT` returns `T | false | null`. Always guard before accessing the payload:

```typescript
const decision = await conditionLT<{ approved: boolean }>(signalId, escalationConfig);

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
