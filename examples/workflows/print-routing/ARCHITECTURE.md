# Print Routing — Architecture

A deep-dive into how every workflow works, why the broker is designed as a singleton hot
loop, and how NATS signal budgeting prevents the harvest from hanging at scale.

---

## Table of contents

- [The marketplace metaphor](#the-marketplace-metaphor)
- [Six workflow types](#six-workflow-types)
  - [`printOrder` — demand](#printorder--demand)
  - [`printer` — supply](#printer--supply)
  - [`printBroker` — the market maker](#printbroker--the-market-maker)
  - [`farmTechnician` — maintenance](#farmtechnician--maintenance)
  - [`farmInspector` — signoff](#farminspector--signoff)
  - [`printShift` — entry target](#printshift--entry-target)
- [The broker in depth](#the-broker-in-depth)
  - [Two cost layers](#two-cost-layers)
  - [dispatchBatch — the hot loop](#dispatchbatch--the-hot-loop)
  - [Chunked harvest — the NATS signal budget](#chunked-harvest--the-nats-signal-budget)
  - [continueAsNew — the checkpoint cadence](#continueasnew--the-checkpoint-cadence)
- [Role and pond design](#role-and-pond-design)
  - [The singleton broker's RBAC](#the-singleton-brokers-rbac)
- [Capacity planning](#capacity-planning)
- [Tunable knobs reference](#tunable-knobs-reference)
- [Operator identity and seeding](#operator-identity-and-seeding)

---

## The marketplace metaphor

The print farm is a two-sided market on one primitive — the escalation queue.

**Supply side — printer adverts.** When a printer is idle, it calls
`Durable.workflow.condition()` with an escalation config and parks. This writes a pending
escalation row in the printer pond (`printer-pool-standard` or `printer-pool-diabetic`)
with metadata describing the machine: `printerId`, `filament`, `sizeClass`, `state=ready`.
That row IS the advert. Sixty printers idle = 60 pending `state=ready` rows in the supply
pond. Availability is a query, not a hash.

**Demand side — order insoles.** When an order arrives, it enqueues one escalation per
insole in the order pond (`print-farm-standard` or `print-farm-diabetic`), all sharing one
`originId`. The `originId` groups them for all-or-nothing claiming: the broker claims an
entire order (all insoles) or none.

**The broker is the market maker.** It scans both sides, matches supply to demand by
capability (`filament`, `sizeClass`) and priority (past-due, key-account, reprint, FIFO),
and resolves each printer's advert with a job payload `{ orderId, callbackKey }`. Resolving
the advert is the handoff — it wakes the printer (Path 0) with the job. The printer runs
the job and signals `callbackKey` on the broker workflow when it's done. The broker
collects the signal and settles the order.

The whole lifecycle — idle, busy, refilling, retired — is rows in the printer pond. The
fleet's health is a query over those rows. No side store to keep in sync.

---

## Six workflow types

### `printOrder` — demand

**Role:** convergence owner. Holds the original intent and loops until intent equals actual.

**Pattern:** fixpoint loop with durable waits at the boundary.

```typescript
let outstanding = order.units.map((_, i) => i);  // intent: all units
let attempt = 0;
while (outstanding.length && attempt < MAX_PRINT_ATTEMPTS) {
  const originId = attempt === 0 ? orderId : `${orderId}#a${attempt}`;
  await enqueueOrderUnits({ order, originId, unitIndices: outstanding, reprint: attempt > 0, ... });
  // park until the broker settles this group
  const done = await Durable.workflow.condition<OrderDoneSignal>(orderSignal);
  // park until the farmer inspects and signs off
  const signoff = await Durable.workflow.condition<SignoffPayload>(signoffKey, {
    role: farmerPond, type: ORDER_SIGNOFF_TYPE, ...
  });
  outstanding = signoff.failedUnits;  // rejected units re-enter the funnel
  attempt += 1;
}
```

**Convergence:** the `originId` changes each attempt (`${orderId}#a1`, `#a2`, …) so each
reprint is its own group, sized to the deficit. The broker claims it by the same rules —
capability, capacity, priority — with no special reprint path. A clean order is the
degenerate case: one pass, empty `outstanding`.

**Why it owns the loop:** the convergence predicate (`outstanding.length`) is business
logic, not infrastructure. Keeping it in the workflow — not scattered across activities —
means it survives crashes, replays cleanly, and is readable as a plain loop.

---

### `printer` — supply

**Role:** the assembly-line machine. One durable workflow per physical printer.

**Pattern:** bounded `while` loop, `conditionLT` as the wait-for-work primitive.

```typescript
while (totalRuns < EOL_RUNS) {
  if (runsUntilRefill <= 0) {
    // needs filament — post maintenance advert, wait for technician
    await Durable.workflow.condition<RefillPayload>(refillSignal, {
      role: printerPool, type: PRINT_WORKFLOWS.PRINTER, subtype: PRINTER_STATE.MAINTENANCE,
      metadata: { ...facets, state: 'maintenance' },
    });
    runsUntilRefill = REFILL_INTERVAL;
    refills += 1;
    continue;
  }

  // advertise as ready — the broker resolves this with a job payload
  const job = await Durable.workflow.condition<PrinterJobPayload>(readySignal, {
    role: printerPool, type: PRINT_WORKFLOWS.PRINTER, subtype: PRINTER_STATE.READY,
    metadata: { ...facets, state: 'ready' },
  });
  if (job?.powerdown) break;       // shift power-down command
  if (job?.callbackKey) {
    await runPrintJob({ job, printerId });
    totalRuns += 1;
    runsUntilRefill -= 1;
  }
}
return { retired: true, totalRuns, refills };  // asset EOL
```

**The advert IS the printer's state.** The pending escalation row says "ready" or
"maintenance" — the platform's pending/claimed/resolved status is the machine's state
machine. No separate state store is needed.

**Bounded loop, not `continueAsNew`.** A printer has a finite life (`EOL_RUNS = 10`), so
its execution history is bounded. `continueAsNew` is for infinite loops; `while` is for
bounded assembly-line idioms. Retirement is workflow completion.

**Payload dispatch.** The `Durable.workflow.condition()` resolution payload carries the
job. New machine states are new branches in the loop — `job.jammed`, `job.paused`, etc.
The loop absorbs them without structural change.

---

### `printBroker` — the market maker

**Role:** singleton market maker for both ponds. Runs indefinitely.

**Pattern:** `dispatchBatch` activity (hot loop) + chunked condition harvest + `continueAsNew`.

See [The broker in depth](#the-broker-in-depth) for the full design. The outer structure:

```typescript
export async function printBroker(envelope) {
  // 1. dispatchBatch — N iterations inside one activity call
  const { pairings, unplaced, didWork } = await dispatchBatch({ ... });

  // 2. Chunked harvest — conditions in batches to cap NATS subscriptions
  const CHUNK = d.conditionChunkSize ?? 20;
  const dones = [];
  for (let ci = 0; ci < pairings.length; ci += CHUNK) {
    const chunk = pairings.slice(ci, ci + CHUNK);
    dones.push(...await Promise.all(chunk.map(p =>
      Durable.workflow.condition(p.callbackKey)
    )));
  }

  // 3. settleOrder per order (groups pairings by originId, chunked at CONDITION_CHUNK)
  for (let oi = 0; oi < orderEntries.length; oi += CONDITION_CHUNK) {
    await Promise.all(
      orderEntries.slice(oi, oi + CONDITION_CHUNK).map(({ group, ... }) =>
        settleOrder({ group, ... })
      )
    );
  }

  // 4. continueAsNew — carry unplaced forward
  await Durable.workflow.continueAsNew({ data: { ...d, carried: unplaced, ... } });
}
```

**Why singleton?** A singleton eliminates contention between competing brokers. With multiple
brokers and `allOrNone` atomic claims, slow brokers block fast ones from taking their slots —
a recipe for fragmentation and carry storms. One broker, one market, no contention.

**Why both ponds?** The standard broker principal holds all four pond roles so `dispatchBatch`
can iterate `[standard, diabetic]` in one pass. The singleton sees the full floor.

---

### `farmTechnician` — maintenance

**Role:** resolves `state=maintenance` adverts in the printer pond. One singleton per fleet kind.

**Pattern:** `continueAsNew` loop with `inspectorSignoff` activity call per tick.

```typescript
const adverts = await lt.escalations.searchByFacets({
  role: printerPool, status: 'pending', facets: { state: 'maintenance' }
});
for (const advert of adverts.data.escalations) {
  await lt.escalations.resolve({ id: advert.id, resolverPayload: { action: 'added-filament' } });
}
// resolving wakes the parked printer, which resets runsUntilRefill and continues
```

In production, a human dashboard operator claims and resolves these. The technician
workflow automates it for self-draining tests.

---

### `farmInspector` — signoff

**Role:** resolves order-done signoff escalations in the farmer pond. One singleton per fleet kind.

**Pattern:** `continueAsNew` loop with `inspectorSignoff` activity.

```typescript
const pending = await lt.escalations.searchByFacets({ role: farmerPond, status: 'pending' });
for (const e of pending.data.escalations) {
  const failedUnits = e.metadata.failUnits ?? [];
  await lt.escalations.resolve({ id: e.id, resolverPayload: {
    passed: failedUnits.length === 0,
    failedUnits,
    inspectedBy: inspectorId,
  }});
}
// resolving wakes the parked order; non-empty failedUnits triggers a reprint loop
```

**Failure injection.** The `failUnits` metadata field on the signoff escalation is how
tests inject defects: the inspector passes it back to the order, which re-enqueues only
the failing indices. In production, a vision system or human sets this.

---

### `printShift` — entry target

**Role:** runs the whole farm end-to-end from one dashboard invocation. The only invocable
workflow in the set (others are registered but not invocable by default).

**What it does:**
1. Starts the fleet (printers), broker, technician, inspector as child workflows.
2. Enqueues order waves — priority wave (key-account order), defect wave (failing unit),
   closing wave (normal orders that drain remaining capacity).
3. Waits for all orders to converge.
4. Powers down idle printers (resolves their `ready` advert with `{ powerdown: true }`).
5. Returns the headline: orders printed, insoles, reprints, machines powered down.

The shift is the scenario script. The underlying actors are stateless and composable.

---

## The broker in depth

### Two cost layers

| Layer | Cost | Frequency |
|-------|------|-----------|
| Durable workflow step | NATS message + DB write | Once per `continueAsNew`, once per `condition()` |
| ProxyActivity body (plain JS) | Zero durable cost | Every iteration inside `dispatchBatch` |

The naive design (one durable activity call per scan/claim/handoff iteration) fires one
NATS message per second, even while idle. The `dispatchBatch` design fires one message
per batch — effectively once per ~40s active, once per ~10min idle.

### dispatchBatch — the hot loop

`dispatchBatch` is a proxy activity: it runs inside HotMesh's activity wrapper (one
durable checkpoint on return) but its body is plain async JS. The broker calls it once
per outer tick; `dispatchBatch` iterates `maxIterations` times before returning.

```
dispatchBatch(maxIterations=10):
  for i in 0..maxIterations:
    carried → lockPrintersAndHandoff → pairings + unplaced
    for pond in [standard, diabetic]:
      claimOrdersForCapacity → fresh buckets
      lockPrintersAndHandoff → more pairings + more unplaced
    if idle: sleep(idleSleepMs)    // quiet floor — no work
    else:    sleep(activeSleepMs)  // work placed — let printers start
  return { pairings, unplaced, didWork }
```

**`lockPrintersAndHandoff` uses `allOrNone: true`** on `claimByFacets`. This means N
printers for an N-insole order are claimed atomically — zero fragmentation. If N printers
aren't available, the order stays in the carry backlog.

**Carry, don't release.** When `lockPrintersAndHandoff` can't place all claimed orders
(e.g., a printer advert expired between scan and claim), the unplaced orders are returned.
The broker carries them — still claimed — into the next `dispatchBatch` call via
`continueAsNew`. On the next tick, carried orders go first (they have implicit priority:
they were already claimed and are aging).

**Claim TTL and recovery.** Order-insole claims have a 5-minute TTL (`claimMinutes`). If
the broker's harvest step takes longer than 5 minutes (e.g., an extreme stall), a carried
group's claim expires and the insoles return to the pool — where they are re-claimed fresh
on the next `claimOrdersForCapacity` call. This is the orphan-recovery floor: a crash or
extended stall never permanently locks insoles. Size `claimMinutes` above the expected
worst-case harvest time (for a 200-printer fleet with conditionChunkSize=20, that is
`ceil(200/20) × max_print_job_seconds`).

**Dual-pond loop.** Both `[false, true]` (standard and diabetic) ponds are scanned in the
same loop iteration. The singleton broker handles both sides of the floor without awareness
of which kind it's working — the role gates enforce capability isolation; the broker just
iterates ponds.

### Chunked harvest — the NATS signal budget

After `dispatchBatch` returns pairings, the broker opens `Durable.workflow.condition()`
for each pairing — one live NATS subscription per condition. Each printer's completion
signal arrives event-driven (the printer calls `resolveEscalation` which delivers a NATS
message to the broker workflow).

**The problem at scale.** Opening N conditions simultaneously means N concurrent NATS
subscriptions are registered in sequence. A fast printer (completing in under 1ms) may
signal before its condition row is registered, and the signal is dropped — the broker
waits forever.

**The fix: chunk the harvest.** Process pairings in batches of `conditionChunkSize`:

```typescript
const CHUNK = d.conditionChunkSize ?? 20;
for (let ci = 0; ci < pairings.length; ci += CHUNK) {
  const chunk = pairings.slice(ci, ci + CHUNK);
  const dones = await Promise.all(chunk.map(p =>
    Durable.workflow.condition(p.callbackKey)
  ));
  // all conditions in chunk are open before any printer in this chunk can complete
}
```

All conditions in a chunk are opened simultaneously (via `Promise.all`), then the chunk
settles before the next chunk opens. Printers retry their signal delivery for up to 30s,
so a 200ms inter-chunk overhead is invisible to them.

**Sizing.** The hard cap is **20 on all environments** — local Docker and AWS alike. The
durable workflow's Promise.all collation layer has a practical limit of 20 concurrent items;
beyond that, the NATS signal bus risks a subscription storm. The bash entry point
(`10-farm.sh`) hard-fails on any `CONDITION_CHUNK_SIZE` above 20. Both `print:pressure`
and `print:remote:pressure` default to 20.

### continueAsNew — the checkpoint cadence

After the harvest, the broker calls `continueAsNew` with:

```typescript
{ data: { ...d, cumulative, idleRuns, carried: unplaced } }
```

This is the ONLY durable checkpoint in the outer loop (beyond the `condition()` calls
themselves, which are each one checkpoint). `continueAsNew` bounds execution history —
without it, the workflow's replay log grows unboundedly over weeks/months of operation.

**Idle termination.** If `idleRuns >= maxIdleRuns`, the broker returns normally instead
of calling `continueAsNew`. For production: set `maxIdleRuns=999999`. For bounded test
runs: `maxIdleRuns=300` (300 consecutive idle ticks = self-terminate).

---

## Role and pond design

Six roles, three ponds, two fleet kinds:

| Role | Pond | Who holds it |
|------|------|--------------|
| `print-farm-standard` | Order demand (standard) | Orderer operator, broker operator |
| `print-farm-diabetic` | Order demand (diabetic) | Orderer operator, broker operator (singleton) |
| `printer-pool-standard` | Printer supply (standard) | Printer operator, technician, broker operator |
| `printer-pool-diabetic` | Printer supply (diabetic) | Printer operator, technician, broker operator (singleton) |
| `print-farmer-standard` | Signoff (standard) | Inspector operator |
| `print-farmer-diabetic` | Signoff (diabetic) | Inspector operator |

Role gates are enforced by the platform at the database level. A caller without the role
cannot `searchByFacets`, `claimGroups`, or `resolve` escalations in that pond. This is
the capability wall — not code.

### The singleton broker's RBAC

The standard broker principal (`0a000000-0000-4000-8000-000000000001`) holds all four
pond roles (both standard and diabetic, for both order and printer ponds):

```typescript
broker: k === 'standard'
  ? [PRINTER_POND.standard, ORDER_POND.standard, PRINTER_POND.diabetic, ORDER_POND.diabetic]
  : [PRINTER_POND[k], ORDER_POND[k]],
```

This is what makes the singleton design possible: one principal, all ponds, no per-pond
broker processes. The diabetic broker principal still exists in the seed for forward
compatibility, but the singleton runs as the standard broker principal.

Seeded by `scripts/print-seed.ts` from `allOperatorSeeds()` in `operators.ts`.

---

## Capacity planning

| Symbol | Default | Meaning |
|--------|---------|---------|
| `EOL_RUNS` | 10 | Print runs before a machine retires |
| `REFILL_INTERVAL` | 3 | Runs between filament refills |
| `FLEET_SIZE` | env | Number of printers |
| `DAILY_VOLUME` | env | Total orders |

**Capacity rule:** `FLEET_SIZE × EOL_RUNS ≥ DAILY_VOLUME + (expected reprints)`

A 200-printer fleet can handle 2,000 print runs. 300 orders × 5 avg insoles = 1,500 runs,
leaving 33% headroom for reprints.

**`STALL_MS` formula (demand watchdog timeout):**

```typescript
const STALL_MS = process.env.STALL_MS
  ? parseInt(process.env.STALL_MS, 10)
  : Math.max(60_000, FLEET_SIZE * 600 + 10_000);
```

For 200 printers: `Math.max(60_000, 200 × 600 + 10_000) = 130_000ms`. This gives the
broker enough time to complete a full harvest batch before the demand watchdog gives up.

**Fleet exhaustion** is not an error — it's expected when the farm runs longer than the
printers' combined EOL. The broker idles, the watchdog fires, and the test stalls.
Size the fleet so `FLEET_SIZE × EOL_RUNS > DAILY_VOLUME`.

---

## Tunable knobs reference

All knobs live on `BrokerData` (passed at broker invocation time and carried across
`continueAsNew`).

| Knob | Default | Effect |
|------|---------|--------|
| `maxAdverts` | 10 | Max `ready` adverts read per pond per iteration. Raise for large fleets. |
| `conditionChunkSize` | 20 | Max concurrent NATS subscriptions in the harvest. **Hard cap: 20 on all environments.** The bash entry guard rejects values above this. |
| `maxIterations` | 10 | Inner loop iterations per `dispatchBatch` call before checkpointing. |
| `activeSleepMs` | 200 | Sleep between active iterations (work placed). |
| `idleSleepMs` | 1000 | Sleep between idle iterations (no work found). |
| `maxIdleRuns` | 3 | Consecutive idle outer ticks before self-terminating. |
| `claimMinutes` | 5 | Claim TTL — orphaned claims recover in this many minutes. |

For production: `maxIdleRuns=999999`, `conditionChunkSize=20`, `maxAdverts` = `ceil(FLEET_SIZE / 2)`.

`maxAdverts` is the broker's capacity horizon per scan — how many ready-printer adverts it
reads to estimate available filament/sizeClass slots. The singleton broker runs the inner
loop `maxIterations` times per activity call, so a fleet of N printers is covered
approximately `maxIterations × maxAdverts / N` times per activity checkpoint. Setting
`maxAdverts = ceil(FLEET_SIZE / 2)` gives ~5× full-fleet coverage at `maxIterations=10` —
enough that no printer sits invisible for more than one activity cycle.

---

## Operator identity and seeding

Each robot (broker, technician, inspector, orderer, printer) runs as a named operator
principal. Operators are identified by deterministic UUIDs in `operators.ts`:

```
standard broker:     0a000000-0000-4000-8000-000000000001  (holds all 4 pond roles)
standard technician: 0a000000-0000-4000-8000-000000000002
standard inspector:  0a000000-0000-4000-8000-000000000003
standard orderer:    0a000000-0000-4000-8000-000000000004
standard printer:    0a000000-0000-4000-8000-000000000005
diabetic broker:     0a000000-0000-4000-8000-000000000006  (standard + diabetic pond roles)
diabetic technician: 0a000000-0000-4000-8000-000000000007
diabetic inspector:  0a000000-0000-4000-8000-000000000008
diabetic orderer:    0a000000-0000-4000-8000-000000000009
diabetic printer:    0a000000-0000-4000-8000-00000000000a
```

`npm run print:seed` inserts these users with the correct roles. Run once per fresh
database (after `docker compose down -v`).

The throughput harness (`10-supply.ts`) reads operator IDs from `operatorIds()` and
passes them as workflow start data. The workflows authenticate as these operators when
calling role-gated escalation APIs.
