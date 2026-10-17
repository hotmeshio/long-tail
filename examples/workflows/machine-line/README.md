# Machine Line: machines resolve escalations over MQTT

A person works an escalation row on the dashboard: they claim it, add to it and
resolve it with a form. In this example, machines work the same rows the same
way, over MQTT instead of a form. A gateway sits between the two. It reads Long
Tail's escalation events and the machines' messages, and it runs the same verbs
a person would, logged in as each machine.

The example is a three-station line (press, cut, inspect) with a person at line
exit. The outcome that matters is the **handoff**: a station's work is done when
the next station says it **received** the units.

## The handoff row

For each move of a set of units from a sender to a receiver, the
`machineUnitRoute` workflow parks one row on the receiver's role. The workflow
never talks to machines; the gateway does.

| A person on the dashboard | A machine, through the gateway |
|---|---|
| Sees a new row in the queue | `created` event: the gateway sends `dispatch` to the receiver |
| Claims the row | The receiver accepts the dispatch (`cmd/reply` accepted): the gateway claims the row as the receiver |
| Adds notes and records | The sender's `finished` and the receiver's `arrived` job events are added as items, one per unit (`released:<unit>`, `arrived:<unit>`) |
| Submits the form | Every unit arrived with the dispatched carrier: the gateway resolves `{ received: true }` as the receiver |

The last hop goes to `line-exit`, where a person takes the units off the last
machine and resolves the same kind of row on the dashboard. Machines and people
are interchangeable resolvers; `claimed_by` and `resolved_by` name whichever did it.

```
 workflow            Long Tail rows               gateway                 machines
 ────────            ──────────────               ───────                 ────────
 handoff(cut) ─────▶ row: line-trim  ──created──▶ dispatch ──cmd──────────▶ cut-01
                                                           ◀─cmd/reply──── accepted
                     claimed by cut-01 ◀───claim──
                     item released:U1 ◀──accumulate◀─job finished───────── press-01
                     item arrived:U1  ◀──accumulate◀─job arrived────────── cut-01
 ◀── received ────── resolved by cut-01 ◀─resolve─
```

### When a handoff ends without a receipt

The row resolves `{ received: false, errorCode }` (or times out), and the
workflow parks a `line-operator` row whose form offers `retry`, `manual` or
`scrap`. Retry dispatches the same hop again as a new attempt, so it fits
failures in the move itself (jam, refusal, no reply, timeout). Units the sender
finished as reject or hold are still on the sender: `manual` hands them to a
person from there, `scrap` ends the route.

| Situation | What the gateway sees | `errorCode` |
|---|---|---|
| The receiver refuses the job (mode, recipe, queue, artifact) | `cmd/reply` refused or failed | `dispatch-refused` |
| No reply after every attempt (same `cmdId` each time) | reply deadline | `no-reply` |
| The receiver runs software the line does not allow | `presence`/`snapshot` software | `software-unsupported` |
| The sender finished the units as reject or hold | job `finished`, result not ok | `sender-rejected` |
| Jam, incomplete handshake, wrong carrier, unreadable id | job `transfer-failed` | `jam`, `incomplete-handshake`, `carrier-mismatch`, `unreadable-id` |
| The receiver gives the job back | job `withdrawn` | `withdrawn` |
| Nobody reports receipt in time | row `timeout` | `handoff-timeout` |
| The workflow or an operator cancels | row `cancelled` | the gateway sends `cancel` to both machines |

### Rows for people

Stopping alarms (`alarm/<id>` at level `critical` or `emergency`) become `line-alarm`
rows on `line-operator`. Clearing the alarm at the machine resolves the row with
who cleared it; resolving the row first sends `ack-alarm`. A machine whose
presence goes offline past a debounce gets a `machine-offline` row, and a
connected machine that goes silent gets a `machine-quiet` row; both resolve when
it is heard again. A machine that restarts and loses its queue (new `bootId` in
its snapshot) gets its accepted jobs dispatched again with the same `cmdId`.

## The line protocol

One topic tree per machine, `{root}/{site}/{line}/{machine}/...`, every payload
wrapped in `{ v, id, at, source: { site, line, machine }, body }`. The contract
is in [`protocol/`](protocol/) and validated with ajv.

| Channel | Direction | Retained | Purpose |
|---|---|---|---|
| `presence` | machine → | yes | Birth and will, with the software version |
| `snapshot` | machine → | yes | Mode, recipe, jobs, alarms, counters, `bootId` |
| `job` | machine → | no | `queued`, `ready`, `arrived`, `started`, `progress`, `finished`, `released`, `transfer-failed`, `withdrawn` |
| `alarm/<id>` | machine → | while active | Raised, acknowledged, cleared (with who cleared it) |
| `telemetry` | machine → | no | Readings; proves the machine is alive |
| `cmd` | → machine | no | `dispatch`, `cancel`, `enable`, `disable`, `ack-alarm`, `snapshot` |
| `cmd/reply` | machine → | no | `accepted`, `refused` (with a reason), `failed` |

Commands carry a `cmdId` (a repeat is answered, never run twice) and an
`expiresAt`.

## Topology

```
  machines ──MQTT 3.1.1, TLS, client cert──▶ site NATS ──leafnode──▶ Long Tail NATS ◀── Long Tail
                                             JetStream                  (lt.events.>)
                                                 ▲
                                    gateway ─────┘  NATS (streams) + MQTT (commands, QoS 1)
```

- **Site NATS** runs JetStream and the MQTT listener. It joins Long Tail's NATS as
  a leafnode, so escalation events and machine subjects share one subject space,
  and the site keeps running while the link to Long Tail is down.
- **Streams**: `LINE_EVENTS` (machine events, 30 days), `LINE_TELEMETRY` (3 days),
  `LINE_LT_EVENTS` (Long Tail escalation events, 7 days). The gateway reads events
  and escalations through durable consumers: after a restart it picks up where it
  stopped. A message whose row does not exist yet is redelivered later.
- **Commands** leave through an MQTT session at QoS 1, so a command waits for a
  machine that is away.

### Identities

- **Broker**: one client certificate per machine (the CN is its user,
  `verify_and_map`). A machine may publish only under its own topics and
  subscribe only to its own `cmd`. The gateway logs in by certificate over MQTT
  to command the line and by password over NATS to read the streams.
  [`site/setup.ts`](site/setup.ts) issues the dev CA and certificates and renders
  `site.conf` from the line into the gitignored `deploy/machine-site/`.
- **Long Tail**: one bot account per machine, holding the station roles and
  `line-exit`, plus a controller bot that also holds `line-operator`. At boot the
  gateway logs in, makes sure each bot exists, and mints a fresh API key for each.

## Run it

```bash
docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml up -d --build
npm run machine:line
```

The machines override adds `machine-site` (certificates and `site.conf`),
`site-nats`, `machine-mock` (the simulated line, drills on `:8090`) and
`machine-gateway`, and gives Long Tail's NATS a leafnode listener. Adding the
override to a stack that already ran needs `up -d --build -V` once, so the
containers pick up the `mqtt` dependency.

The driver starts unit routes and plays the people: it takes units off the last
machine and receives them at exit, clears alarms, and decides failed handoffs.

```bash
UNITS=8 BATCH=2 npm run machine:line
FAULT=jam npm run machine:line                  # jam leaving press-01; operator retries
FAULT=reject DECIDE=scrap npm run machine:line
FAULT=offline npm run machine:line              # machine-offline row, then restored
```

`FAULT` is one of `jam`, `incomplete`, `carrier_mismatch`, `unreadable`, `stall`,
`reject`, `hold`, `estop`, `offline`; `FAULT_AT` picks the machine. When a host
port is taken, set `LT_NATS_PORT` and point the driver at it with `NATS_URL`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MACHINE_TRANSPORT` | `memory` | `nats` (site NATS), `mqtt` (any MQTT broker), `memory` (tests, one process) |
| `MACHINE_ESCALATION_FEED` | by transport | `jetstream` (site stream), `core` (Long Tail NATS, no replay), `memory` |
| `MACHINE_TOPIC_ROOT` | `line/v1` | Topic tree root |
| `MACHINE_LINE_CONFIG` | built-in line | JSON line definition (see [`line.ts`](line.ts)) |
| `MACHINE_SITE_NATS_URL`, `_USER`, `_PASSWORD` | | Site NATS for streams (`nats`) |
| `MACHINE_MQTT_URL` | | MQTT endpoint |
| `MACHINE_MQTT_CA`, `_CERT`, `_KEY` | | TLS files; `{clientId}` picks each identity's certificate |
| `MACHINE_MQTT_USERNAME`, `_PASSWORD`, `_PROTOCOL` | | Password login; MQTT version (4 or 5) |
| `MACHINE_REPLY_TIMEOUT_MS` | `5000` | Wait for `cmd/reply` |
| `MACHINE_DISPATCH_ATTEMPTS` | `3` | Dispatch tries before `no-reply` |
| `MACHINE_OFFLINE_DEBOUNCE_MS` | `15000` | Offline this long before a row |
| `MACHINE_QUIET_MS` | `90000` | Silent this long before a row; `0` turns it off |
| `MACHINE_DISPATCH_TTL_MS` | `600000` | How long a dispatch stays valid at the machine |
| `LT_BASE_URL` | `http://localhost:3000` | Long Tail API for the gateway |
| `LT_GATEWAY_TOKEN` or `LT_GATEWAY_USERNAME`/`_PASSWORD` | | Gateway login that can manage bot accounts |
| `MOCK_LINE_*` | see [`mock/settings.ts`](mock/settings.ts) | Mock pace, faults, heartbeats |

## Layout

| Path | What it holds |
|---|---|
| [`protocol/`](protocol/) | Topics, envelope, contract |
| [`line.ts`](line.ts), [`config.ts`](config.ts) | Line definition, environment |
| [`contracts.ts`](contracts.ts), [`forms.ts`](forms.ts) | Row types, facets, resolutions, role forms |
| [`workflows/`](workflows/) | `machineUnitRoute` and its pure route planning |
| [`gateway/`](gateway/) | Pure planners (event → actions), executor, Long Tail HTTP client, identities |
| [`transport/`](transport/) | Memory, NATS and MQTT transports, streams, selector |
| [`mock/`](mock/) | The simulated line and its `/sim/*` drills |
| [`site/`](site/) | Site broker certificates and `site.conf` |

Roles and forms are seeded by [`seed-machine-line.ts`](../../seed-machine-line.ts).
Unit tests live in `tests/examples/machine-line/`; the workflow test in
`tests/workflows/machine-unit-route.test.ts`; the end-to-end test against the
machines override in `tests/integration/machine-line.test.ts`.
