# Printer Twin — the physical/digital boundary

[print-routing](../print-routing/) proves the marketplace at throughput with simulated
machines — see its [ARCHITECTURE.md](../print-routing/ARCHITECTURE.md) for the market
design (supply adverts, demand groups, the broker, claim TTLs, signal budgets). This
example takes the next step: each durable workflow is the **digital twin of one real
machine** sitting behind a print-farm-manager host (e.g. a Windows machine running a
vendor's print farm manager, with the printers joined to it over the farm network).

The twin's escalation surface is its JIT UI. At any moment, the one pending escalation a
twin holds tells the world what the machine needs next — and resolving (or cancelling)
that row is how the world answers.

## Actors

| Workflow | Side | What it does |
|----------|------|--------------|
| `printerTwin` | supply | One per physical machine. Registration → availability → printing → service, all as escalations. |
| `twinOrder` | demand | One row per unit, one origin group; parks until the set settles. |
| `twinBroker` | market maker | Claims demand sized to supply, locks the printer **set** all-or-nothing, dispatches to the farm manager, harvests, settles. |

## Roles

| Role | Who holds it |
|------|--------------|
| `print-servicer` | Humans who unbox, register, refill, and repair machines |
| `printer-fleet` | Twin adverts + in-flight rows; the twin, broker, and farm-manager callback operate here |
| `print-jobs` | Demand rows; the order and broker operate here |

## The twin's lifecycle (each state is an escalation)

```
created (unboxed)
   │
   ▼
registering ──► print-servicer plugs the machine in, joins it to the farm
   │            manager, fills the registration form (serial, model, date,
   │            filament, certifications, xl/pdac/soft), submits
   ▼
ready ────────► availability advert carrying the capability facets; the broker
   │            claims printer SETS against these (allOrNone) and resolves each
   │            advert with its job {gcodeUrl, callbackKey, printDoneKey}
   ▼
printing ─────► the physical rendezvous. The broker has told the farm manager
   │            to print; the farm-manager callback resolves this row when the
   │            machine reports. created_at → resolved_at IS the print duration.
   │
   ├─ resolved (success/fail) ──► twin reports to the broker, back to ready
   └─ CANCELLED (machine went dark; a farm worker cancels from the dashboard)
                │
                ▼
service ──────► print-servicer physically restores the machine, submits the
                service form (action, filament changes, notes) — the twin is
                realigned with its machine and re-enters the pool
```

Cancellation is first-class: cancelling any pending twin escalation wakes the parked
`condition()` with `{ __escalation_cancelled: true }`, and the twin detours through a
`service` escalation before advertising again. A power outage is just a batch of
cancellations followed by a batch of service visits.

## The farm-manager boundary (the placeholder)

`twinBroker` calls one proxyActivity per dispatched job:

```typescript
await notifyFarmManager({ job: { serialNumber, model, jobId, gcodeUrl, printDoneKey, ... } });
```

Backend is env-selected — no code changes between mock and real:

| Env var | Default | Meaning |
|---------|---------|---------|
| `FARM_MANAGER_BACKEND` | `mock` | `mock` = simulate the physical side; `http` = dispatch to a real host |
| `FARM_MANAGER_BASE_URL` | — | Required for `http` (e.g. `http://192.168.1.50:4000`) |
| `MOCK_PRINT_SECONDS` | `1` | Simulated print time for the mock backend |

**mock** — the activity plays the machine: it waits `MOCK_PRINT_SECONDS`, then resolves
the twin's `printing` row through the public API — *exactly the call the real callback
makes*, so promoting to `http` changes only who makes it.

**http** — the activity POSTs the job to `${FARM_MANAGER_BASE_URL}/print-jobs` with the
gcode URL (a signed URL the host downloads) and the callback contract.

### The callback contract

When a print finishes (or fails), the farm-manager host reports by resolving the twin's
`printing` row — one authenticated POST to the long-tail API:

```bash
curl -X POST http://<long-tail-host>:3010/api/escalations/resolve-by-signal-key \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <operator-token>' \
  -d '{
    "signalKey": "print-done-<jobId>",
    "resolverPayload": { "outcome": "success", "reportedBy": "farm-manager" }
  }'
```

The `signalKey` (`printDoneKey`) arrives in the dispatch request, so the host only
echoes it back. `outcome` is `success` or `fail`. That single call wakes the twin,
records the outcome on the row, and cascades: twin → broker → order.

## Office connectivity walkthrough (the staging farm)

Goal: laptop (long-tail + twins) ↔ Windows machine (print farm manager) ↔ printers, all
on the office wifi.

1. **Same-LAN first — no tunnel needed.** Give the Windows machine a static DHCP lease,
   allow the farm manager's port through Windows Defender Firewall (private network
   profile), and verify from the laptop: `curl http://<windows-ip>:<port>/`. Then start
   long-tail with `FARM_MANAGER_BACKEND=http FARM_MANAGER_BASE_URL=http://<windows-ip>:<port>`.
2. **Callback direction.** The Windows host must reach the laptop's long-tail API
   (`http://<laptop-ip>:3010`). Same LAN, same story — just the macOS firewall to allow.
   When long-tail runs in docker compose the port is already published.
3. **Tunnels (ngrok etc.) are for crossing networks**, not for this office loop. They
   become useful when the digital side moves to AWS and must reach the factory host —
   or prefer no inbound exposure at all: the callback POST is outbound-only from the
   factory, so only the dispatch direction needs a tunnel or VPN.

Client-isolation on some office wifi blocks peer-to-peer traffic — if both directions
fail while the internet works, wire both machines to the same switch/SSID without
isolation.

## Pace Board — throughput of the farm

The three roles are operationalized on the Operations **Pace Board** via static
config in [`examples/seed-twin.ts`](../../seed-twin.ts) (seeded at startup) — the
same mechanism `ortho:populate` uses. Two segments render:

```
Print Jobs ─▶ Printer Fleet        production line (demand → print)   [2]
                  ▲
                  └── Print Servicer   maintenance side-quest          [1]
```

`ops_visible` marks a role tracked; `parent_role` chains a segment (a root with no
parent starts one); `upstream_roles` draws the merge glyph (a serviced machine
re-enters the fleet). Each role carries dials — `target_per_hour` (the Target band),
`sla_minutes`, and `priority_threshold_minutes` (the age/priority count). Tune them
in the admin Roles UI or `PATCH /api/roles/:role`; the seeder only configures
unconfigured roles, so your tuning survives restarts. The `twin:farm` driver also
ensures this config at run-start, so the board populates even without a full seed.

Note: `printer-fleet` blends `ready` adverts (idle supply), `printing`, and
`dispatched` under one role — its *pending* reads as available-plus-in-flight and
its *resolved* is completed prints (the real throughput signal).

## Running it — the driver script (effortless path)

`npm run twin:farm` drives the whole thing from one command. It launches the fleet,
**plays the print-servicer automatically** (registration and service visits), starts the
broker, places orders, and reports what happened — so a single run exercises the full
lifecycle including the failure detour.

```bash
npm run twin:farm                                   # 4 printers, 6 orders, mock backend
FLEET=6 ORDERS=10 UNITS=2 npm run twin:farm         # bigger fleet
FAIL_PCT=30 npm run twin:farm                        # inject dead-machine → service
FLEET_CAPS="xl|pdac|full|full" npm run twin:farm     # vary capabilities per printer
FARM_MANAGER_URL=http://192.168.1.50:4000 npm run twin:farm   # preflight the office link
KEEP=1 npm run twin:farm                             # leave twins running to poke in the UI
```

All knobs (`FLEET`, `ORDERS`, `UNITS`, `FILAMENTS`, `ARRIVAL_S`, `FAIL_PCT`, `POLL_MS`,
`BROKER_IDLE`, `RUN_BROKER`, `KEEP`, `FARM_MANAGER_URL`, `FLEET_CAPS`, `BASE_URL`) are
documented in the header of [`scripts/twin-farm.ts`](../../../scripts/twin-farm.ts). It
logs in as `superadmin` (which bypasses the pond role gates, so no operator seeding is
needed) and every order it plans is sized to be satisfiable by the fleet.

**Failure injection** (`FAIL_PCT`) cancels a fraction of in-flight prints, racing the
physical side — so it's best-effort. For a wider, more reliable window, raise the app's
`MOCK_PRINT_SECONDS` (e.g. `MOCK_PRINT_SECONDS=4` in the app environment) so the cancel
lands mid-print. You can also just cancel a `printing` row by hand from the dashboard.

### By hand (dashboard or SDK)

```bash
# 1. Start a twin (one per machine):
#    printerTwin  { printerId: 'printer-01', operatorId: '<fleet operator user id>' }
# 2. Register: claim the 'registering' escalation under print-servicer, fill the form, submit.
# 3. Start the broker (singleton):
#    twinBroker   { brokerId: '<fleet+jobs operator user id>' }
# 4. Place an order:
#    twinOrder    { filament: 'pla', require: { xl: true }, units: [{ gcodeUrl: 'https://...' }, ...], operatorId: '<jobs operator user id>' }
```

Watch the escalations dashboard: the order's demand rows appear, the broker locks the
printer set, `dispatched` + `printing` rows open, the mock (or the real farm manager)
resolves them, and everything settles. To rehearse a failure, cancel a `printing` row
mid-flight — the service escalation appears for the print-servicer, and the unit comes
back as `outcome: 'cancel'` in the order result.
