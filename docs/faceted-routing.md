# Faceted Routing

The escalation queue is more than a HITL inbox — it is a durable, queryable pool of work
that any number of consumers can search and atomically claim by its **facets**. Faceted
routing is the platform surface for that: a composable query language over the queue and a
set of atomic claim primitives. The platform supplies the surface; the *policy* — what a
facet means, how capability and priority map onto it, the matching loop — is the consuming
app's. The [print-routing example](../examples/workflows/print-routing/README.md) is a full
worked policy built entirely on these primitives.

## Contents

- [The model](#the-model)
- [The query — `FacetQuery`](#the-query--facetquery)
- [Reads](#reads)
- [Atomic claims](#atomic-claims)
- [The dispatcher pattern](#the-dispatcher-pattern)
- [Recording the outcome on resolve](#recording-the-outcome-on-resolve)
- [Safety](#safety)

## The model

Every escalation row carries a `role` (the hard isolation boundary) and a `metadata` JSONB
object (the soft facets a late-binding consumer queries, sorts, and claims by). Routing
work is a funnel over those columns:

- **Capability** — the hard wall — is the `role`. A consumer bound to one role can never
  see another role's work. Soft capability is `metadata @>` containment.
- **Preference / priority** — ordering — is `orderBy` over top-level columns and facets.
- **Capacity** — how much to take — is the page `limit` of a claim.

An **order** (or any multi-unit job) is a set of rows sharing an `origin_id`; its unit
count lives in a metadata facet so a group can be claimed all-or-nothing only when complete.

## The query — `FacetQuery`

```typescript
interface FacetQuery {
  role?: string;                    // hard isolation (exact)
  roles?: string[];                 // role = ANY(...)
  facets?: Record<string, any>;     // metadata @> facets  — required (AND), GIN-served
  block?: Record<string, any>[];    // NOT (metadata @> ANY(block)) — exclusion list
  range?: { facet: string; op: '<' | '<=' | '>' | '>=' | '='; value: number }[];
  exists?: string[];                // metadata ? key — facet must be present
  status?: string;                  // e.g. 'pending'
  available?: boolean;              // true = unclaimed/expired only; false = held now
  orderBy?: { field: string; direction?: 'asc' | 'desc'; numeric?: boolean }[];
  limit?: number;
  offset?: number;
}
```

`orderBy.field` is either a whitelisted top-level column (`priority`, `created_at`,
`updated_at`, `status`, `role`) or a metadata path written as `metadata.<key>` (extracted as
text, or numeric when `numeric` is set). Every value is parameterized; only validated column
names / metadata keys and a fixed operator set are ever interpolated.

```typescript
// Pending, available diabetic-certified work needing PLA, soonest-deadline first.
const query: FacetQuery = {
  role: 'print-farm-diabetic',
  status: 'pending',
  available: true,
  facets: { filament: 'pla' },
  orderBy: [{ field: 'metadata.mustCompleteBy', numeric: true, direction: 'asc' }],
};
```

## Reads

```typescript
import { searchByFacets, searchGroups, countByFacets } from '@hotmeshio/long-tail';

// Item-level: filter/sort over columns and metadata facets.
const { escalations, total } = await searchByFacets(query);

// Order-level: each row is an origin group with its unit count, availability and
// completeness — what a batched dispatcher reads to page by capacity.
const groups = await searchGroups(query, { sizeFacet: 'orderSize', limit: 10 });

// Aggregate: capacity / in-flight soft-limit checks.
const inFlight = await countByFacets({ role: 'print-farm-diabetic', available: false });
```

## Atomic claims

Two claim primitives, both `FOR UPDATE SKIP LOCKED` so many consumers run without
contention. Each takes the `FacetQuery`, a `consumer` id, and options.

```typescript
import { claimGroups, claimByFacets } from '@hotmeshio/long-tail';

// Claim whole orders (origin groups), all-or-nothing, in rank order. The page `limit`
// is how many consumers/printers are free, so a dependent grabs exactly what it can
// distribute. A group is only eligible when complete (member count = declared size).
const orders = await claimGroups(query, 'broker-1', { limit: 4, sizeFacet: 'orderSize' });

// Claim individual rows by facet — the single-row sibling. Locks up to `limit` available
// rows in rank order. With { allOrNone: true } the claim commits only when the full limit
// is acquired, otherwise it rolls back and returns [] — the all-or-none lock a dispatcher
// wants over a counted set it anticipated.
const printers = await claimByFacets(
  { role: 'printer-pool-diabetic', facets: { state: 'ready' } },
  'broker-1',
  { limit: 4 },
);
```

A claim sets `assigned_to` + `assigned_until` (default 30 minutes). Availability is a
query, not a flag: a row is held iff `assigned_to` is set and `assigned_until > NOW()`.
Resolve, release, or let the claim expire to return it to the pool.

## The dispatcher pattern

The primitives compose into a market: pull a *page* of complete orders sized to how many
consumers are free, then distribute one per consumer. Reads go through the
`public.lt_escalations` view (it adds the computed `available` flag); atomic claims run on
the shared `public.hmsh_escalations` table — the same raw-SQL-on-the-shared-table pattern as
the rest of the escalation service. Metadata facets use the GIN index (`@>`).

```typescript
// 1. Anticipate supply.
const free = await searchByFacets({ role: 'printer-pool', available: true, facets: { state: 'ready' } });
// 2. Claim that much demand by priority.
const orders = await claimGroups(demandQuery, consumer, { limit: free.escalations.length });
// 3. Lock the printers for the claimed orders, all-or-none.
const printers = await claimByFacets(supplyQuery, consumer, { limit: orders.length, allOrNone: true });
// 4. Pair, do the work, resolve both.
```

See the [print-routing example](../examples/workflows/print-routing/README.md) for the full
two-sided market, carry-forward under contention, and the inspection/convergence loop.

## Recording the outcome on resolve

A row is created carrying **intent** — the facets that route and claim it. Resolving it can
record the **outcome** onto the same row: pass a `metadata` patch and it is merged (not
replaced) into the GIN-indexed metadata in the same atomic UPDATE, on the winning resolve
only. "What actually happened" becomes `@>`-queryable next to "what was asked".

```typescript
import { resolveEscalation } from '@hotmeshio/long-tail';

// The work is done; resolve the row AND stamp the outcome onto it — one atomic call.
await resolveEscalation(rowId, { result: 'success' }, {
  outcome: 'success',
  unitsPrinted: 6,
});
// Duration needs no facet: the row's own created_at → resolved_at is the elapsed time.
```

The third argument is distinct from the second: `resolverPayload` (arg 2) is delivered to a
waiting workflow as `condition()`'s return value and is **not** indexed; the `metadata` patch
(arg 3) is the durable, queryable record on the row. With both, the row alone answers what was
asked, what happened, and how long it took:

```typescript
searchByFacets({ role: 'printer-pool-diabetic', facets: { state: 'printing', outcome: 'success' } });
// → every completed job: which consumer, which origin, how long — no side table to reconcile
```

The print farm leans on this: a printer resolves its in-flight `printing` row with the run's
result and units in one atomic call, so the supply pond is also the production log — and the
row's `created_at` → `resolved_at` is the print duration, no stored field required.

## Safety

- **Parameterized** — every value is a bound parameter; only audited column names, metadata
  keys (strict `^[a-zA-Z0-9_]+$`), and a fixed operator set are interpolated.
- **Atomic** — claims are single transactions with `FOR UPDATE SKIP LOCKED`; group claims
  re-check completeness *inside* the lock, so concurrent dispatchers never split a group or
  double-claim a row.
- **Durable consumers** — because the surface is a query, a consumer that holds a claim it
  cannot yet place can carry it across `continueAsNew` and converge later rather than
  releasing — the durable workflow is the coordinator, not a distributed transaction.
