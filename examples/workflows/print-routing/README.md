# Print Routing — an enterprise print farm where printers are workflows

A 3-D print farm is the textbook hard-routing problem: a steady stream of orders, a
finite fleet of printers, a hard capability wall (diabetic insoles run only on
dedicated hardware), soft preferences (filament and printer size must match),
deadlines (turnaround-time / TAT), and orders that are all-or-nothing.

This example routes that work using only what the platform already ships — the
general faceted escalation queue and the durable workflow primitives — and takes one
more step: **the printer is itself a durable workflow**. A printer advertises its
availability as an escalation; that escalation is the membrane where the digital twin
meets the physical world. The whole fleet's story becomes a query over the queue.

## Table of contents

- [The two ponds](#the-two-ponds)
- [The funnel](#the-funnel)
- [Facets](#facets)
- [Actor 1 — `printOrder` (demand)](#actor-1--printorder-demand)
- [Actor 2 — `printer` (supply, a station loop)](#actor-2--printer-supply-a-station-loop)
- [Actor 3 — `printBroker` (the market maker)](#actor-3--printbroker-the-market-maker)
- [Actor 4 — `farmTechnician` (maintenance)](#actor-4--farmtechnician-maintenance)
- [Actor 5 — `farmInspector` (signoff)](#actor-5--farminspector-signoff)
- [The escalation lifecycle is the printer's state machine](#the-escalation-lifecycle-is-the-printers-state-machine)
- [The fleet's whole story is one query](#the-fleets-whole-story-is-one-query)
- [Production shape](#production-shape)
- [Files](#files)
- [Running it](#running-it)

## The two ponds

The design is a two-sided market on one primitive. Supply and demand never call each
other — they meet only on the escalation queue.

- **Demand pond** — order insole escalations (`print-farm-diabetic` / `print-farm-standard`).
  An order writes its insoles as one `origin_id` group and parks.
- **Supply pond** — printer adverts (`printer-pool-diabetic` / `printer-pool-standard`).
  A printer posts a `ready` advert when it is free, or a `needs-filament` advert when it
  needs service.

A printer is **available iff it holds a pending `ready` advert** — availability is a
query, not a hash.

## The funnel

| Routing concept | General primitive |
| --- | --- |
| Capability — the hard wall | `role` (diabetic vs standard, for both ponds) |
| Capability — soft match | `metadata` facets `@>` (`filament`); size fits with xl→standard overflow (`capability.ts`) |
| Priority — what runs first | a pluggable ordered rule list composed into `orderBy` (see `priority.ts`) |
| An order | one `origin_id` group, claimed all-or-nothing (`claimGroups`) |
| A printer set | batch-locked by facet (`claimByFacets`, `SKIP LOCKED`); unplaced orders carried |
| A printer advertises | `conditionLT` writes the advert and suspends the printer |
| the broker hands off a job | resolving the advert wakes the printer (Path 0) with a callback key |
| the printer reports done | it signals the broker's callback key; the broker settles the order |
| run count / refill / EOL | printer-workflow state across a bounded `condition` loop |

## Facets

Order insoles carry `orderSize`, `unitIndex`, `side`, `filament`, `sizeClass`,
`diabetic`, `customerId`, `approvedAt`, `mustCompleteBy` (jeopardy), and `orderSignal`.
Printer adverts carry `printerId`, `state` (`ready` | `maintenance`), `filament`,
`sizeClass`, `totalRuns`, and `runsUntilRefill`. The `state` facet is what decides who
resolves an advert: the broker resolves `ready`, the technician resolves `maintenance`.

## Actor 1 — `printOrder` (demand)

The order is the **convergence owner** — the one actor that holds the original intent, so
reconciliation lives here. It runs a fixpoint loop: each pass prints the outstanding
units, the farmer inspects them, and whatever is rejected re-enters the *same* funnel as a
fresh deficit group — until intent ≡ actual. A route is a hypothesis; the durable loop
converges it. A clean order is the degenerate case: one pass, nothing rejected.

```typescript
let outstanding = order.units.map((_, i) => i);          // the intent
let attempt = 0;
while (outstanding.length && attempt < MAX_PRINT_ATTEMPTS) {
  const originId = attempt === 0 ? orderId : `${orderId}#a${attempt}`;   // own group per pass
  await enqueueOrderUnits({ order, originId, unitIndices: outstanding, role, orderSignal, workflowId });
  const done = await Durable.workflow.condition<OrderDoneSignal>(orderSignal);          // printed
  const signoff = await conditionLT<SignoffPayload>(signoffKey, { role: farmerPond, ... }); // inspected
  outstanding = signoff.failedUnits;                     // rejected units re-enter the funnel
  attempt += 1;
}
return { type: 'return', data: { orderId, printed: true, passed: !outstanding.length, attempts: attempt } };
```

The deficit re-enqueues as its own origin group (`${orderId}#a1`), sized to the deficit, so
the broker claims it complete and routes it by the identical rules — capability, capacity,
priority. The only nondeterminism is the inspection result crossing the escalation boundary;
the loop's reaction to it is pure and replayable. Dynamism in the data, determinism in the
machinery.

## Actor 2 — `printer` (supply, a station loop)

One durable workflow per machine. Its life is bounded (`EOL_RUNS`), so it loops
its advert/suspend cycle inside a single execution — the assembly-line idiom of
repeated `condition` calls, not a `continueAsNew` loop. Each iteration advertises via
`conditionLT`, suspends, wakes on the outcome, and advances state.

```typescript
while (totalRuns < EOL_RUNS) {
  if (runsUntilRefill <= 0) {                                              // needs filament
    await conditionLT(refillSignal, { role: printerPool, metadata: { ...facets, state: 'maintenance' } });
    runsUntilRefill = REFILL_INTERVAL; refills += 1; continue;
  }

  const job = await conditionLT(readySignal, { role: printerPool, metadata: { ...facets, state: 'ready' } });
  if (job && job.callbackKey) {                                          // the broker handed off a job
    await runPrintJob({ job, printerId });                              // run it, signal the broker back
    totalRuns += 1; runsUntilRefill -= 1;                                // a real run consumes filament + a cycle
  }
}
return { retired: true, totalRuns, refills };                            // the asset dies
```

For this example a printer prints **3 runs between refills** (`REFILL_INTERVAL`) and
retires at **10 runs** (`EOL_RUNS`). The asset's death is a workflow completion.

## Actor 3 — `printBroker` (the market maker)

A looping durable singleton (or several) per fleet. The broker is itself a workflow,
and its claim/lock/handoff/settle steps are checkpointed proxy activities — so the
two-sided match is a **durable saga**: each step commits atomically, and the workflow
guarantees the whole tick runs exactly-once across a crash. No distributed DB
transaction is needed because the coordinator drives forward instead of rolling back.

```typescript
// 1. Place the carried backlog first — orders already claimed on an earlier tick
//    that found no printer. Aging work has priority over fresh demand.
let { pairings, unplaced } = await lockPrintersAndHandoff({ buckets: carried, phase: 'c', ... });

// 2. Claim fresh demand only once the backlog is placed, then place it too.
if (!unplaced.length) {
  const fresh = await claimOrdersForCapacity({ diabetic, priorityRules });  // free adverts → buckets →
  //   claimGroups in PRIORITY order — the broker's pluggable rule list, sized to supply
  const r = await lockPrintersAndHandoff({ buckets: fresh.buckets, phase: 'f', ... });
  pairings.push(...r.pairings); unplaced.push(...r.unplaced);
}

// 3. Harvest: every job was already handed off, so the fleet prints in parallel.
//    Collect each printer's completion signal in turn and settle its order.
for (const p of pairings) {
  const done = await Durable.workflow.condition(p.callbackKey); // printer signals this key
  await settleOrder({ group: p.group, done });                  // resolve insoles + wake order
}
// carry `unplaced` forward across continueAsNew — held, not released.
```

Three ideas carry the design:

- **Anticipate, then claim by priority.** `lockPrintersAndHandoff` batch-claims printers
  by facet (`claimByFacets`, `FOR UPDATE SKIP LOCKED`) and resolves each advert with
  `{ orderId, callbackKey }` — the handoff. Claiming demand sized to anticipated supply
  keeps **priority** the deciding factor — and priority is a *business* decision: the
  broker composes an ordered list of named rules (`priority.ts` — past-due, key-account,
  reprint, FIFO) into the claim's `orderBy`. Reorder the list, or hand a broker a different
  one, and the queue reorders — no broker change, no deploy.
- **Carry, don't release.** When a tick claims more orders than it can place (a printer
  slipped away, or a second broker won the race), the surplus is **carried** — still
  claimed — and placed on a later tick. Holding beats release+reclaim churn, and partial
  placement keeps the fleet busy where an all-or-none set lock would idle, or even
  livelock, under broker contention. The durable workflow is what makes "defer to next
  tick" safe; the claim TTL is the only backstop, and only if the broker is *terminated*.
- **Dispatch parallel, harvest sequential.** The rendezvous is the elegant part: the
  broker mints a **deterministic** `callbackKey`, hands it to the printer, and the printer
  signals it back on completion (an early signal is stored, so the handoff-then-wait window
  is order-safe). All handoffs fire first, so the whole fleet prints concurrently; the
  broker then harvests the callbacks one at a time — concurrent `condition` waits in a
  single workflow deadlock, so the harvest is a plain loop.

## Actor 4 — `farmTechnician` (maintenance)

A looping singleton that resolves `needs-filament` adverts. "Added filament" is an
ordinary resolver payload — the same human-in-the-loop mechanism the platform uses
everywhere. Here it is automated so the example self-drains; in production a dashboard
operator claims and resolves these.

```typescript
const lt = createClient({ auth: { userId: technicianId } });   // runs as a printer-pond operator
const adverts = await lt.escalations.searchByFacets({ role: printerPool, status: 'pending', facets: { state: 'maintenance' } });
for (const advert of adverts.data.escalations) await lt.escalations.resolve({ id: advert.id, resolverPayload: { action: 'added-filament' } });
```

## Actor 5 — `farmInspector` (signoff)

A looping singleton that resolves order-done signoff escalations. A printed order is not
*done* until it is inspected: the order surfaces itself to the `print-farmer-*` pond and
parks, and the inspector signs it off — the same human-in-the-loop mechanism, automated
here so the example self-drains. In production a dashboard operator inspects and clicks
sign-off. The signoff pond is a second supply-side membrane: where the broker meets
printers, the inspector meets finished work.

Inspection is where **failure** enters: the farmer can reject specific insoles. A failed
unit is printed and a cycle spent, but the output is bad — the order records exactly which
units the farmer rejected (`failedUnits`), the signal the convergence loop will reprint.

```typescript
const lt = createClient({ auth: { userId: inspectorId } });   // runs as a farmer-pond operator
const pending = await lt.escalations.searchByFacets({ role: farmerPool, status: 'pending' });
for (const e of pending.data.escalations) {
  const failedUnits = e.metadata.failUnits ?? [];   // units the farmer rejects (none = clean)
  await lt.escalations.resolve({ id: e.id, resolverPayload: { passed: failedUnits.length === 0, failedUnits, inspectedBy } });
}
// resolving wakes the parked order, which returns with the inspection on its result
```

## The escalation lifecycle is the printer's state machine

The platform's escalation statuses already are the machine — you model no state
separately:

| Escalation state | Printer reality |
| --- | --- |
| `pending`, unclaimed (`available`) | idle, advertised, ready to print |
| claimed (`assigned_to`) | printing, or on the bench being serviced |
| `resolved` (`result: success`) | job done, inspection passed — one run off its life |
| `resolved` (`result: fail`) | job done, inspection failed — filament and a cycle still spent |
| `cancelled` | a human interrupted the job mid-print |
| `expired` (claim timed out) | the print ran long or the machine went dark — surfaces for attention |

## The fleet's whole story is one query

Because every transition is a row, a printer's entire life — every run, every refill,
its retirement — is recoverable from the supply pond:

```typescript
lt.escalations.searchByFacets({ role: 'printer-pool-diabetic', facets: { printerId: 'printer-1' } });
// → the full trail: 10 resolved `ready` adverts + 3 resolved `maintenance` adverts
```

Utilization, failure rate, current assignments, lifetime runs, remaining life — all of
it is an aggregation over those rows. No side-store to keep in sync.

## The boundary records intent and outcome

A `printing` escalation opens with the **intent** — which machine, which order, the job in
flight. When the printer finishes, it resolves that same row with the **outcome** — `result`
and units — in one atomic call: the status-guarded UPDATE marks the row resolved, resumes the
broker, and merges the outcome facets, together or not at all. The boundary **duration** is not
stored: the row's own `created_at` (handoff) → `resolved_at` (done) *is* the duration, derived
by query. One row, both halves of the story:

```typescript
lt.escalations.searchByFacets({ role: 'printer-pool-diabetic', facets: { state: 'printing', outcome: 'success' } });
// → every completed print: which printer, which order — resolved_at − created_at is how long it took
```

Intent and outcome are the same GIN-indexed row, never a side table to reconcile. The
escalation queries answer it all: work to do, work done, time taken, what was retried, what
retired and when.

## Production shape

- **Printers** are launched on a `Virtual.cron` (or by a fleet-onboarding flow); a
  retired printer is replaced by starting a fresh `printer` workflow.
- **Brokers, technician, and inspector** are looping singletons; the throttle keeps idle
  ticks cheap and `continueAsNew` keeps execution history bounded.
- **Outcomes re-enter from reality** — a print head's sensor, a vision-inspection
  webhook, or a human all resolve the same advert. The escalation boundary is the only
  place the physical and digital worlds touch.

### Efficiency

- **Throughput scales by running more brokers (and inspectors/technicians).** They contend
  through `SKIP LOCKED` claims and carry what they cannot place, so they never split an
  order or starve — they only converge a little slower. This is the horizontal lever; the
  `print-routing-carry.test.ts` proves two contending brokers stay correct.
- **The harvest is parallel.** Every job is dispatched up front; the broker then awaits all the
  callbacks in one collated `Promise.all` and settles them together. A tick costs ~max(print-time),
  not the sum. Each wait is a `printing` escalation, resumed when the printer resolves the row —
  the same write that records the outcome.
- **Tunable knobs** on `BrokerData`: `claimMinutes` (claim TTL — short so an orphaned claim
  recovers in minutes, not the 30-min default), `maxAdverts` (per-tick capacity horizon — a
  fleet larger than this is served by more brokers), and the pacing `tickSeconds` /
  `idleTickSeconds` / `maxIdleRuns`.
- **It polls, by necessity.** Durable workflows cannot subscribe to events — only Agents can
  (`services/agent/trigger-registry.ts` arms subscriptions to `system.escalation.*.created`).
  An agent that wakes a broker on each new `ready` advert is the event-driven path that would
  eliminate idle ticks; the polling loop is the portable default.

## Files

The directory is the map — one file per actor, barrel-loaded:

| Path | Role |
| --- | --- |
| `index.ts` | Barrel — re-exports the five actors plus `printShift`, the entry target |
| `types.ts` | Roles (demand + supply + signoff ponds), facet keys (incl. `OUTCOME_FACETS`), lifecycle constants, shapes |
| `policy/` | The pluggable strategy: `priority.ts` (priority rules), `capability.ts` (soft fit + overflow), `manifest.ts` (facet set) |
| `workflows/` | The five actors: `order.ts`, `printer.ts`, `broker.ts`, `technician.ts`, `inspector.ts`, plus `shift.ts` (the entry target) and `proxy.ts` (shared activity handles) |
| `activities/` | Their side effects: `order.ts`, `broker.ts`, `printer.ts`, `technician.ts`, `inspector.ts`, `signal.ts`, `shift.ts` (scenario + power-down) |

Three workflow tests prove it:

- `print-routing.test.ts` — **lifecycle**: one printer drains 10 orders, refills after
  runs 3/6/9, retires at run 10, and its whole story is a single query.
- `print-routing-farm.test.ts` — **the fleet**: four printers (three standard, one xl)
  drain 12 mixed orders concurrently; xl work routes only to the xl machine; standard
  work spreads across the standard fleet.
- `print-routing-carry.test.ts` — **carry-forward**: two brokers contend for two printers
  and nine orders; claims that lose the printer race are carried, not released, so every
  order converges exactly once with no orphan, duplicate, or livelock.
- `print-routing-defect.test.ts` — **convergence**: a flawed order reprints exactly its
  rejected unit through the same funnel until intent ≡ actual (clean orders converge in one pass).
- `print-routing-priority.test.ts` — **pluggable priority**: with one printer and equal
  deadlines, a key account jumps ahead of orders that arrived before it.
- `print-routing-overflow.test.ts` — **soft capability**: standard orders overflow onto the
  xl machine when standard capacity is full; an xl order stays a hard fit (xl-only).
- `print-routing-shift.test.ts` — **the entry target**: one `printShift` runs the whole farm
  end to end (12 orders, three flavor waves), drains, powers down idle machines, and proves
  every finished print recorded its outcome + duration on the `printing` row.

## Running it

### One click — `printShift`

`printShift` is the entry target: invoking it runs the whole farm. It powers on the fleet
(a near-end-of-life machine and a fresh one) plus the dispatcher, technician, and inspector,
then feeds twelve orders through three flavor waves — **priority** (a key-account order jumps
the queue), a **defect** (the fixpoint loop reprints it), and a **closing** run that drives
the refills and a retirement. The dispatcher works the floor until it is idle, the shift
drains, and idle machines are powered down so nothing lingers. Everything defaults:

```json
// printShift — an empty data object runs the standard full-lifecycle scenario
{ "data": { "diabetic": false, "idleTickSeconds": 1, "maxIdleRuns": 12, "waveGapSeconds": 1 } }
```

The result is the headline (orders printed, insoles, reprints, machines powered down); the
detail is the escalation trail — every `printing` row carries its outcome and duration.

### By hand — the actors

To drive the actors yourself: enable the examples (`examples: true`), start a printer, then a
broker, technician, and inspector for its fleet, and enqueue orders with `printOrder`:

```json
// printer
{ "data": { "printerId": "printer-1", "diabetic": false, "filament": "pla", "sizeClass": "standard" } }
// printBroker / farmTechnician / farmInspector
{ "data": { "diabetic": false, "tickSeconds": 1, "idleTickSeconds": 5 } }
// printOrder
{ "data": { "customerId": "acme", "diabetic": false, "filament": "pla", "sizeClass": "standard",
            "approvedAt": 0, "mustCompleteBy": 0, "units": [{ "side": "L" }, { "side": "R" }] } }
```

The printer advertises, the broker matches and prints, the technician refills it, the
inspector signs off finished orders, and the parked orders converge to `done`.
