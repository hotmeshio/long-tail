# Printer Twin — the physical/digital boundary

[print-routing](../print-routing/) proves the marketplace at throughput with simulated
machines. This example takes the next step: each durable workflow is the **digital twin
of one real machine** behind a Bambu Farm Manager Server. The twin keeps a canonical
mirror continuously in sync with the physical printer by **polling ground truth** — and
every divergence that needs a decision becomes a durable escalation. The escalation
surface is the adaptive layer; that is where resilience comes from.

## Why poll, not callbacks

The real Farm Manager API has **no event for the states that matter most**: printer
offline/online, stop-confirmation, and bed_clean/reset-confirmation never webhook, and
`job_failed` fires only for autonomous failures (not a client stop). A callback-driven
twin drifts out of sync exactly when the real world gets messy. So the twin treats
**poll as the source of truth, poll wins every conflict**, and self-heals within one poll
interval. Webhooks, when present, are only an optional accelerant — never required for
correctness. (See `bambu_config/DIGITAL_TWIN_SPEC.md` for the full event surface.)

## Actors

| Workflow | Side | What it does |
|----------|------|--------------|
| `printerTwin` | supply | One per physical machine. A poll → reconcile → act loop over a canonical `mirror`. |
| `twinOrder` | demand | One row per unit, one origin group; parks until the set settles. |
| `twinBroker` | market maker | Claims demand sized to supply, locks the printer **set** all-or-nothing, hands off, harvests, settles. |

## Roles

Each **human** role owns the versioned `form_schema` for its escalation surface —
declared on the role in [`seed-twin.ts`](../../seed-twin.ts), never on the workflow and
never inline on the escalation (see [`forms.ts`](forms.ts)). The twin raises an escalation
to a role; the dashboard renders that role's schema.

| Role | Escalation surface (its `form_schema`) |
|------|----------------------------------------|
| `print-onboarder` | Registration form — a human registers + binds a newly unboxed machine |
| `print-servicer` | Service form — reload filament, inspect a failure (reset/decommission), restore an offline machine |
| `printer-fleet` | Twin availability adverts + in-flight rows (no human form); the twin and broker operate here |
| `print-jobs` | Demand rows (no human form); the order and broker operate here |

The workflow is registered plain (`certified: false`) — no workflow-level resolver schema
and no "certify for HITL" tier. RBAC and the escalation schema live entirely on the roles.

## The mirror + reconciliation

Each twin persists a `mirror` — identity, membership (`bound`), liveness (`online`), the
print state machine (`gcodeState`, progress, `hms`), the current job, and its own
bookkeeping (see [`mirror.ts`](mirror.ts)). Every tick, the twin polls the machine,
folds the snapshot into the mirror (**poll wins**), and runs the pure
[`reconcile()`](reconcile.ts) function, which returns the next mirror plus a typed list
of actions — Bambu commands and escalation I/O — that the batch activity executes.

`reconcile()` is pure and exhaustively unit-tested (`tests/examples/printer-twin-reconcile-*`).
It owns the whole state machine and its idempotency: a broker-dispatched job is reported
terminal exactly once; each escalation kind is opened at most once (the open-row ledger).

## Lifecycle (each state is derived from the mirror; each decision is an escalation)

```
onboarding ─ servicer registers + the twin binds the machine (register escalation)
   ▼
ready ───── advertises availability; the broker resolves the advert with a job
   ▼
printing ── uploads + prints on the real machine; reconciles to a poll-confirmed terminal
   ├─ FINISH  → report success → bed_clean → needs_reset → ready
   ├─ FAILED (autonomous) → report fail → failure_inspect (servicer) → reset → ready
   ├─ PAUSE + filament HMS → paused_filament → filament_change (servicer) → resume
   └─ offline (poll only, debounced) → offline_investigate (servicer); hold or give up
   ▼
retiring ── drain in-flight, bed_clean, unbind → retired (workflow completes)
```

`PAUSED_FILAMENT` vs an operator pause is distinguished from the HMS signature **by poll
alone** — the twin never trusts a `job_paused{auto_pause}` webhook. `NEEDS_RESET` is
first-class because the machine rejects a new print until `bed_clean` returns it to IDLE.

## Continuation & the hot loop (memory-efficient by design)

- **No `Durable.sleep` between polls.** The poll/reconcile/act loop runs inside a single
  ~60s [`pollReconcileBatch`](activities/twin-batch.ts) proxyActivity (plain-JS internal
  pacing) — one durable checkpoint per batch, not one per poll. This is the two-cost-layers
  pattern from [../print-routing/ARCHITECTURE.md](../print-routing/ARCHITECTURE.md).
- **No `continueAsNew`.** The twin continues via `startChild` with an incrementing link
  counter (`${printerId}-l${n}`), carrying the mirror forward — the proven fleet idiom.
  A duplicate spawn collides and the sitting link keeps its seat (leader safety).

## The Bambu backend (env-selected)

The twin codes against a single [`bambu-client`](activities/bambu-client.ts) interface, so
the workflow never changes between simulation and the real server:

| Env var | Default | Meaning |
|---------|---------|---------|
| `BAMBU_BACKEND` | `mock` | `mock` = deterministic in-repo simulation; `http` = real Farm Manager over mTLS |
| `MOCK_PRINT_SECONDS` | `3` | Simulated print duration (mock) |
| `TWIN_POLL_MS` / `TWIN_BATCH_MS` | `2000` / `8000` | Baseline poll cadence + batch window (raise to 20s/60s for production) |

The **mock** ([`bambu-mock.ts`](activities/bambu-mock.ts)) faithfully replicates
`bambu_config/mock_server_reference/server.py` — the same state machine, command guards,
and deliberate no-event gaps — with a deterministic outcome control (`success | failed |
filament_runout`) armed per printer (tests) or carried on a job's `simOutcome` (the
driver), so every reconcile branch is reachable with no network.

The **http** backend (next pass) will present the mTLS client cert/key + custom CA with a
forced SNI via Node's `node:https`, reading everything from env (`BAMBU_BASE_URL`,
`BAMBU_CLIENT_CERT/KEY`, `BAMBU_CA_CERT`, `BAMBU_SERVERNAME`, `BAMBU_ADMIN_USER/PASS`).
Cutover is config-only — no twin code changes. The local mock, certs, and API references
live only under the gitignored `bambu_config/`.

## Pace Board — throughput of the farm

The three roles are operationalized on the Operations Pace Board via static config in
[`examples/seed-twin.ts`](../../seed-twin.ts): `Print Jobs → Printer Fleet` (production
line) with `Print Servicer` as a side-quest merging in. `ops_visible` marks a role
tracked; `parent_role` chains a segment; `upstream_roles` draws the merge glyph. Dials
(`target_per_hour`, `sla_minutes`, `priority_threshold_minutes`) tune the bands.

## Running it — the driver (effortless path)

`npm run twin:farm` drives the whole thing from one command: it launches the fleet, plays
the print-servicer automatically (registration, filament changes, failure inspections),
starts the broker, places orders, and reports what happened.

```bash
npm run twin:farm                                        # 4 printers, 6 orders, mock backend
FLEET=6 ORDERS=10 UNITS=2 npm run twin:farm              # bigger fleet
FAIL_PCT=30 FAIL_MODE=filament_runout npm run twin:farm  # fault → service → recover
FLEET=4 ORDERS=4 KEEP=1 npm run twin:farm                # leave twins running to poke in the UI
```

Faults are injected deterministically via an order unit's `simOutcome` (the mock honors
it), so the service escalations fire on demand — no racing the physical side. All knobs
(`FLEET`, `ORDERS`, `UNITS`, `FILAMENTS`, `ARRIVAL_S`, `FAIL_PCT`, `FAIL_MODE`, `KEEP`,
`FLEET_CAPS`, `BASE_URL`) are documented in the header of
[`scripts/twin-farm.ts`](../../../scripts/twin-farm.ts). It logs in as `superadmin`
(which bypasses the pond role gates), and every order it plans is fleet-satisfiable.

### By hand (dashboard or SDK)

```bash
# 1. Start a twin:  printerTwin { printerId: 'printer-01', operatorId: '<fleet operator>' }
# 2. Register: resolve the 'registering' escalation under print-servicer (serial, model, filament, xl/pdac/soft).
# 3. Start the broker: twinBroker { brokerId: '<fleet+jobs operator>' }
# 4. Place an order: twinOrder { filament: 'pla', require: { xl: true }, units: [{ gcodeUrl: '…' }, …], operatorId: '<jobs operator>' }
```

Watch `/escalations` and `/operations`: the twin registers and binds, advertises, prints
via poll-confirmed FINISH, and — when a unit faults — opens a filament-change or
failure-inspect escalation that a servicer resolves before the machine re-enters the pool.
