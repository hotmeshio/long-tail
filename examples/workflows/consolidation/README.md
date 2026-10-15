# Consolidation: containers that know what they hold and what is coming

Orders for one destination converge on one container. Each order passes two stations,
waits staged, and is placed in its destination's bin. Whoever packs a bin asks two
questions, every time: **what is in it now, and what is still on its way?**

This example answers both from the container role's list schema alone. The bins are
escalation rows (open accumulators), the orders are escalation rows in each station's
role, and the list view composes them with two related sets: no bespoke service, no
second query per row.

## The pieces

| Piece | What it is |
|---|---|
| `consolidationOrder` | One order: a wait at `order-prep`, then `order-check`, each row carrying `orderId`, `destination`, `serviceLevel`; then staged in `order-stage` as an accumulator of one |
| `consolidationBin` | One container: an open accumulator in `consolidate`, carrying `binKey` and `destination`, optionally a `lane` (one bin per lane in the same tub) |
| `schemas.ts` | The container list schema (`CONSOLIDATE_LIST_SCHEMA`) and the station lists |
| `../../seed-consolidation.ts` | Seeds the four roles. The three order roles form one Pace Board sequence through `parent_role` |

Placing an order is one reciprocal add: `POST /api/escalations/:binId/accumulate` with
`{ itemKey: orderId, reciprocal: { id: stagedRowId } }` writes the bin and the staged row
in one statement, and the staged order's workflow completes.

## The container list

```jsonc
"x-lt-related": {
  "contents": { "source": "items" },
  "coming": { "source": "query",
              "query": { "segment": "order-prep",
                         "facets": { "destination": "{{metadata.destination}}" },
                         "narrow": { "serviceLevel": "{{metadata.lane}}" } } }
}
```

- **Holds** counts each bin's items, split by the staged order's `serviceLevel`
  (`reciprocal.metadata.serviceLevel`): `3 · Standard 2 · Express 1`.
- **Coming** counts the pending rows for the same destination along the order sequence,
  by station: `2 · Prep 1 · Check 1`. A lane narrows that to its own service level; the
  tub line reads the union of its lanes.
- Expanding a row lists the orders in the bin and the orders on their way, each opening
  its own row.
- `x-lt-group-by: "metadata.binKey"` reads the lanes of one tub as one line.

Everything reads under the viewer's scope; see
[List Schema: Related sets](../../../docs/hitl/x-lt-list-schema.md#related-sets).

## Running it

```bash
docker compose up -d --build
npm run consolidation:sim                       # a full run: every order placed
KEEP=1 ORDERS=12 npm run consolidation:sim      # stops mid-flight: orders at every station
```

Open **Consolidate** (`/escalations/available?role=consolidate`). Resolve a row in
**Order · Check** and watch its destination's Coming move to Staged; place it and watch
it join Holds.

The tests drive the same floor on real workers: `tests/workflows/consolidation-views.test.ts`
and `tests/workflows/consolidation-scope.test.ts`.
