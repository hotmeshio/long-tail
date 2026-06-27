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
| Capability — soft match | `metadata` facets `@>` (`filament`, `sizeClass`) |
| Preference — what runs first | `orderBy` over facets (jeopardy `mustCompleteBy`, then size) |
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
  const fresh = await claimOrdersForCapacity({ diabetic });   // free adverts → buckets →
  //   claimGroups by priority (jeopardy: mustCompleteBy↑, then orderSize↓), sized to supply
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
  keeps **priority** the deciding factor.
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
const adverts = await searchByFacets({ role: printerPool, status: 'pending', facets: { state: 'maintenance' } });
for (const advert of adverts) await escalationApi.resolveEscalation(advert.id, { action: 'added-filament' });
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
const pending = await searchByFacets({ role: farmerPool, status: 'pending' });
for (const e of pending) {
  const failedUnits = e.metadata.failUnits ?? [];   // units the farmer rejects (none = clean)
  await escalationApi.resolveEscalation(e.id, { passed: failedUnits.length === 0, failedUnits, inspectedBy });
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
searchByFacets({ role: 'printer-pool-diabetic', facets: { printerId: 'printer-1' } });
// → the full trail: 10 resolved `ready` adverts + 3 resolved `maintenance` adverts
```

Utilization, failure rate, current assignments, lifetime runs, remaining life — all of
it is an aggregation over those rows. No side-store to keep in sync.

## Production shape

- **Printers** are launched on a `Virtual.cron` (or by a fleet-onboarding flow); a
  retired printer is replaced by starting a fresh `printer` workflow.
- **Brokers and the technician** run on a cron; the throttle keeps idle ticks cheap, and
  `continueAsNew` keeps execution history bounded. Several brokers may share a fleet —
  they contend through `SKIP LOCKED` claims and carry what they cannot place, so they
  never split an order or starve, they only converge a little slower.
- **Outcomes re-enter from reality** — a print head's sensor, a vision-inspection
  webhook, or a human all resolve the same advert. The escalation boundary is the only
  place the physical and digital worlds touch.

## Files

| File | Role |
| --- | --- |
| `types.ts` | Policy: roles (demand + supply + signoff ponds), facet keys, lifecycle constants, shapes |
| `manifest.ts` | The manifest — computes each insole's searchable facet set |
| `activities.ts` | `enqueueOrderUnits`, `claimOrdersForCapacity`, `lockPrintersAndHandoff`, `settleOrder`, `runPrintJob`, `technicianRefill`, `inspectorSignoff`, `signalOrder` |
| `index.ts` | `printOrder`, `printer`, `printBroker`, `farmTechnician`, `farmInspector` |

Three workflow tests prove it:

- `print-routing.test.ts` — **lifecycle**: one printer drains 10 orders, refills after
  runs 3/6/9, retires at run 10, and its whole story is a single query.
- `print-routing-farm.test.ts` — **the fleet**: four printers (three standard, one xl)
  drain 12 mixed orders concurrently; xl work routes only to the xl machine; standard
  work spreads across the standard fleet.
- `print-routing-carry.test.ts` — **carry-forward**: two brokers contend for two printers
  and nine orders; claims that lose the printer race are carried, not released, so every
  order converges exactly once with no orphan, duplicate, or livelock.
- `print-routing-defect.test.ts` — **failure as an outcome**: clean orders pass inspection;
  a flawed order is printed but the farmer rejects exactly its defective unit (`failedUnits`).

## Running it

Enable the examples (`examples: true`), start a printer, then a broker, technician, and
inspector for its fleet, and enqueue orders with `printOrder`:

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
