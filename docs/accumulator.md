# Open accumulator

One escalation row is a container that fills over time. Items join it one at a time, the row stays pending while they do, and the waiting workflow resumes with the ordered collection when the container is full, when its window closes, or when someone closes it by hand. Every terminal path except cancel delivers the collection, so a timeout is a delivery window, never a failure.

This page is the contract. The narrative lives in [Creating Escalations](hitl/escalation.md#open-accumulation--items-arrive-over-time) and [Resolution](hitl/resolution.md#accumulator-items); the endpoints in the [HTTP](api/http/escalations.md#accumulate-items) and [SDK](api/sdk/escalations.md#accumulate--accumulatebysignalkey--accumulatebymetadata) references.

## Declaration

```typescript
const bin = await conditionalAccumulator<ItemPayload, ResolverPayload>(signalId, {
  role: 'bin',
  metadata: { binKey },
  timeout: '4h',
  accumulate: {
    max?: number;            // count trigger; absent = unbounded
    resolveAtMax?: boolean;  // default true; false makes max a cap only
    unique?: boolean;        // default true; false replaces a repeated key in place
  },
});
// AccumulatorResult<P, R> | null
```

`conditional` accepts the same `accumulate` field and returns `T | false | null`; `conditionalAccumulator` removes the `false` branch from the type because an accumulator never resumes with it. `accumulate` and `batch` are mutually exclusive on one wait.

## Delivered value

```typescript
type AccumulatorResult<P, R> = R & {
  $accumulated: Array<{ itemKey: string; payload?: P; at: string; actor?: string; reciprocalId?: string }>;
  $trigger: 'count' | 'timeout' | 'resolve';
  $resolution?: EscalationResolution;
};
```

`$accumulated` is ordered by each entry's `at` (the database clock at the add), then by key. `R` is present only when `$trigger` is `'resolve'`.

| Path | `$trigger` | Row status | `resolver_payload` stored | Wait resumes with |
|------|------------|------------|---------------------------|-------------------|
| The add that reaches `max` (with `resolveAtMax`) | `count` | `resolved` | `{ $accumulated, $trigger }` | the same, plus `$resolution` when the adder carried identity |
| The `timeout` timer fires first | `timeout` | `expired` | `{ $accumulated, $trigger }` | the same |
| `resolve` / `resolveByMetadata` / `resolveAllOrNone` | `resolve` | `resolved` | `{ $accumulated, $trigger, ...resolverPayload }` | the same, plus `$resolution` |
| `cancel` | none | `cancelled` | untouched | `null` (items stay on the row) |

## Reserved keys

Written by the fold at creation, inside the row's Leg1 commit, and maintained by every add and remove:

| Surface | Key | Meaning |
|---------|-----|---------|
| `metadata` (GIN-indexed) | `accumulate_count` | items held right now |
| `metadata` | `accumulate_max` | the count trigger, or `null` when unbounded |
| `metadata` | `accumulate_keys` | held item keys; `metadata @> '{"accumulate_keys":["ORD-9"]}'` finds the container holding that order |
| `envelope` | `accumulate_items` | `Record<itemKey, { payload?, at, actor?, reciprocalId? }>` |
| `envelope` | `accumulate_config` | the folded `{ unique, resolveAtMax }` |

A batch wait may add `partialOnTimeout: true`; it stores `envelope.batch_partial_on_timeout` and its timer delivers `{ ...filledItems, $trigger: 'timeout' }` instead of `false`.

## Operations

| Operation | HTTP | SDK | MCP |
|-----------|------|-----|-----|
| Add by id | `POST /api/escalations/:id/accumulate` | `lt.escalations.accumulate` | `accumulate_item` |
| Add by signal key | `POST /api/escalations/accumulate-by-signal-key` | `accumulateBySignalKey` | |
| Add by facet | `POST /api/escalations/accumulate-by-metadata` | `accumulateByMetadata` | |
| Remove by id | `POST /api/escalations/:id/remove-item` | `removeItem` | `remove_item` |
| Remove by signal key / facet | `POST /api/escalations/remove-item-by-signal-key`, `/remove-item-by-metadata` | `removeItemBySignalKey`, `removeItemByMetadata` | |
| Read the collection | `GET /api/escalations/:id/items` | `getItems` | `get_escalation_items` (admin) |
| Scan | the `accumulate` verb | | |

An add takes `itemKey` (1 to 128 characters), an optional `payload` (validated against the container role's versioned form when present), an optional `metadata` patch (reserved keys rejected), `assertClaim` (by id), and an optional `reciprocal`.

### Outcomes

| Outcome | HTTP | Meaning |
|---------|------|---------|
| `accepted` | 200 | the item landed; `count`, `remaining` (`null` when unbounded) |
| `completed` | 200 | this add reached `max`; the row resolved and the waiter woke, `signaled`, `workflowId` |
| `duplicate-item` | 409 | the key is already held (`unique`), row untouched |
| `full` | 409 | `max` held and the key is new (`resolveAtMax: false`, or a race with the completing add) |
| `not-accumulator` | 400 | the row carries no `accumulate` declaration |
| `not-found` | 404 | unknown row, or outside the caller's scope on the ingress forms |
| `already-resolved`, `already-expired`, `already-cancelled` | 409 | the row is terminal |
| `claimed-by-other`, `claim-expired` | 409 | the `assertClaim` assertion failed |
| `reciprocal-not-found` | 404 | the reciprocal selector matched nothing the caller may act on |
| `reciprocal-not-accumulator` | 400 | the reciprocal row carries no declaration |
| `reciprocal-duplicate`, `reciprocal-full`, `reciprocal-terminal` | 409 | the reciprocal blocked the add; the container is untouched |

Removals answer `removed` (200, with the new `count`), `item-absent` (404), `reciprocal-absent` (404), and the row and reciprocal states above.

## Reciprocal adds

A reciprocal names a second accumulator row (`id`, `signalKey`, or `key` + `value`), typically the item's own escalation declared `accumulate: { max: 1 }`. Both rows are locked in one ordered statement, both guards are evaluated before either write, and both rows change or neither. The container gains the item under `itemKey`; the reciprocal gains the container's id as its item key; each entry carries the other row's id as `reciprocalId`. A side that reaches its `max` resolves and wakes in that same statement. Removal with a reciprocal removes from both rows or neither.

## Guarantees

- **One statement per write.** An add or a removal is a single guarded UPDATE; the resolve-at-max and the wake enqueue ride inside it. There is no read-then-write anywhere on the path; the escalation layer's lookups only pick rows and gate access, and the statement re-checks every predicate under lock.
- **Exactly one completion.** Two adds racing for the last slot yield one `completed` and one terminal answer.
- **Row truth equals delivered value.** Whatever the workflow receives is what the row stores as `resolver_payload`, on every path.
- **Timeout is settled once.** The expiry statement and every resolve lock the row and re-check `pending`; if a resolve won, the timer path skips the resume entirely.
- **Facets are recomputed, never patched.** `accumulate_count` is derived from `accumulate_keys` in the same statement, so the two never drift.
- **Additive.** Existing `conditional`, `batch`, `resolve`, and `cancel` callers are unchanged; `partialOnTimeout` is opt-in.

## Events

Every accepted add and removal publishes `escalation.updated` for the container (and for the reciprocal) with `item_key`, `count`, `remaining`, `actor`, `reciprocal_id`, and `removed: true` on a removal. A completing add publishes `escalation.resolved`. The rows are the ledger: entries carry `at`, `actor`, and `reciprocalId`; `accumulate_keys` answers membership from the GIN index; `accumulate_count` and `accumulate_max` are numeric facets for aggregates and range queries.

## Deferred

`idleTimeoutSeconds` (the window re-arms on each add) and `armTimeoutOnFirst` (the window starts at the first add) need a re-armable engine timer; today the window is a fixed delayed message written at park. A cross-row item event table is also deferred; the rows carry the per-item history. Neither changes the contract above.

## Versions

HotMesh 0.29.0 (`accumulate`, `partialOnTimeout`, timeout delivery, reciprocal statement) and long-tail 0.21.0.
