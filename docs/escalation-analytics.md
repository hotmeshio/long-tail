# Escalation Analytics — Instrumenting a Process

Every escalation is one interval an entity spends in one state: it opens at
`created_at` and closes the instant the row leaves the live set. The
escalation queue is therefore a complete state time-series for every process
the platform runs, and the analytics surface reads it three ways — the
aggregate, the categorical slice, and the individual — from vocabulary the
workflow already writes plus two dials on the role.

This page is the whole authoring contract. The worked example is the seeded
printer scenario (`examples/seed-fleet-sim.ts`), which a fresh install
produces automatically; every call below runs verbatim against it.

## The sixty-second contract

**1. The workflow parks every state as an escalation.** `role` is the queue
that attends the state. `subtype` names the state *within* the role, for
roles that hold several. `metadata` carries the entity key (stored as a JSON
string) plus any categorical facts worth slicing by.

```typescript
// Inside a durable workflow: park the printer in the fleet queue, printing.
const result = await condition(signalId, {
  activity: ltCreateEscalation,
  config: {
    type: 'fleet',
    subtype: 'printing',          // the state, within the printer-fleet role
    role: 'printer-fleet',        // the queue that attends it
    metadata: {
      serialNumber: 'PRN-001',    // the entity
      model: 'h2s',               // categorical facts, sliceable
      pdac: true,
      foaming: false,
    },
  },
});
```

**2. Each role declares two dials** (in the role admin page's Pace Board
section, beside the priority dials, or via `PATCH /api/roles/:role`):

| Dial | Meaning |
|------|---------|
| **Entity** (`entity_facet`) | The metadata key naming what moves through this role — `serialNumber` here. Roles sharing an entity key form that entity's **system**; the system is derived, never maintained. |
| **States from** (`entity_state_source`) | How the role names its contribution to the entity's state space. `'role'` (default): being in this queue is one state — a harvest or service bay. `'subtype'`: the role's subtypes are its states — a fleet role whose rows park as `idle` / `printing`. |

The printer scenario declares three roles:

```
printer-fleet     entity_facet: serialNumber   states from: subtype  (idle, printing)
printer-harvest   entity_facet: serialNumber   states from: role
printer-service   entity_facet: serialNumber   states from: role
```

That is the entire contract. Everything below is reading it back.

## The three questions

### Q1 — the fleet: how did all printers spend their time?

One call: scope to the entity's system, group by the derived state, measure
dwell (open-seconds, clipped to the window).

```bash
ltc esc aggregate-facets --entity serialNumber --group-state \
  --window '{"from":"2026-08-01T00:00:00Z","to":"2026-08-01T12:00:00Z"}'
```

```typescript
const { data } = await client.escalations.aggregateByFacets({
  query: { entity: 'serialNumber' },
  groupBy: { state: true },
  measure: { kind: 'dwell', window: { from, to } },
});
// → groups: [{ state: 'idle', dwellSeconds, ... }, { state: 'printing', ... },
//            { state: 'printer-harvest', ... }, { state: 'printer-service', ... }]
```

```bash
curl -s -X POST http://localhost:3000/api/escalations/aggregate-by-facets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"query":{"entity":"serialNumber"},"groupBy":{"state":true},
       "measure":{"kind":"dwell","window":{"from":"2026-08-01T00:00:00Z","to":"2026-08-01T12:00:00Z"}}}'
```

Each role contributes states per its dial: the fleet's subtypes (`idle`,
`printing`) plus the harvest and service roles themselves.

**Membership** is the other measure — rows (or, with `distinctBy`, distinct
entities) open at an instant. Omit `asOf` for now; a past `asOf` reconstructs
the live set at that moment.

```typescript
// How many printers are in each state right now?
await client.escalations.aggregateByFacets({
  query: { entity: 'serialNumber' },
  groupBy: { state: true },
  measure: { kind: 'membership' },
  distinctBy: 'serialNumber',
});
// → one group per state, count = printers (not rows)
```

### Q2 — the slice: the same, compared by any facet

Q1 plus `groupBy.facets` — each value gets an independent state split, and a
NULL group key is a real group (rows missing the facet).

```bash
ltc esc aggregate-facets --entity serialNumber --group-state --group-facets model \
  --window '{"from":"2026-08-01T00:00:00Z","to":"2026-08-01T12:00:00Z"}'
# → p1s and h2s, each with its own idle/printing/harvest/service dwell
```

Filtering works the same way: `--facets '{"pdac":true}'` restricts the whole
aggregate to the pdac printers.

### Q3 — the individual: how did printer X spend its day?

The ordered interval sequence across the whole system, durations included.
Gaps between intervals are untracked time and are preserved — the settle
latency between queues is a first-class signal.

```bash
ltc esc timeline serialNumber PRN-001 --entity serialNumber
```

```typescript
const { data } = await client.escalations.timelineByFacet({
  facet: { key: 'serialNumber', value: 'PRN-001' },
  query: { entity: 'serialNumber' },
});
// → intervals: [{ role, subtype, startedAt, endedAt, durationSeconds }, ...]
//   open intervals report endedAt: null; gaps appear as time between spans
```

```bash
curl -s -X POST http://localhost:3000/api/escalations/timeline-by-facet \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"facet":{"key":"serialNumber","value":"PRN-001"},"query":{"entity":"serialNumber"}}'
```

## Where the answers appear in the dashboard

- **Q1** — `/operations`: the view selector offers every entity system beside
  the station view; the system band shows state dwell over the selected
  period with membership-now counts and the distinct-entity headline.
- **Q2** — the entity view's **Slice by** control: pick any metadata key the
  rows carry and each value renders its own band, side by side.
- **Q3** — the entity table's timeline action, or the history affordance on
  any metadata value in any escalation list: the full cross-queue journey in
  the side panel, untracked gaps included.

Every surface refreshes from escalation events — resolve something and the
band moves within seconds.

## The interval, precisely

`[created_at, ended_at)`. `ended_at` derives from the terminal transition:
`resolved_at` for resolved rows, `updated_at` for cancelled or expired rows
(both stamped inside their status-guarded transitions), NULL while the row is
live. The `lt_escalations` view exposes it as a computed column, and a
partial index on the terminal end instant keeps history scans bounded — one
index write per row, at its terminal transition.

`liveStatuses` (default `['pending']`) declares which statuses count as
live; everything else is terminal.

## Fail-loud validation

The filter takes the WHAT of a facet query only — `role`/`roles` (or
`entity`), `facets`, `block`, `range`, `exists`. Everything that would
silently change what an aggregate means is rejected with a 400:

- `status`, `available`, `jeopardy` on the filter — liveness derives from
  the interval and the measure
- `orderBy`/`limit`/`offset` on the filter — paging applies to result groups
- `entity` together with `role`/`roles` — one scoping mechanism at a time
- an entity key no role declares — the response names the configuration gap
- `groupBy.state` together with `states[]` — one labeling mechanism
- a window wider than `LT_ANALYTICS_MAX_WINDOW_DAYS`, a future `asOf`,
  malformed facet keys, unknown statuses

Result groups are capped (`LT_ANALYTICS_MAX_GROUPS`); when more exist the
response carries `overflow: true`.

## Access

Aggregates and timelines require `read_all` on every role in scope —
entity-derived roles included. A query with no role scope spans every queue
and requires a global principal. With the public Pace Board flag on,
counts-only aggregates (no facet keys among the group keys) are readable by
any login — the same data class the station metrics expose; facet-keyed
groupings and timelines always take the full gate. See [iam.md](iam.md).

## Reference

- HTTP: [api/http/escalations.md](api/http/escalations.md)
- SDK: `client.escalations.aggregateByFacets` / `timelineByFacet`
- MCP: `aggregate_by_facets` / `timeline_by_facet` on the admin server
- CLI: `ltc esc aggregate-facets`, `ltc esc timeline` — [cli.md](cli.md)
- Config: `LT_ANALYTICS_MAX_GROUPS`, `LT_ANALYTICS_MAX_WINDOW_DAYS`,
  `LT_ANALYTICS_CACHE_TTL_MS`, `LT_ANALYTICS_PAST_CACHE_TTL_MS`,
  `LT_ANALYTICS_CACHE_MAX_ENTRIES`

To watch the seeded fleet move live: `npm run printers:cycle`.
