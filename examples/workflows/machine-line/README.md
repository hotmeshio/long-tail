# Machine Line: one factory, automated and manual

A person works an escalation row on the dashboard: they claim it, add to it and resolve it with a form. Here machines work the same rows over MQTT. Long Tail runs a gateway in process (`start({ machines })`). It reads escalation events and the machines' messages, and performs the verbs a person would, logged in as each machine. The workflow never knows which kind of resolver it waited on. The contract is in [docs/machines.md](../../../docs/machines.md).

## The factory

[`factory-line.json`](factory-line.json) holds:
- two print cells (`print-01`, `print-02`);
- a conveyor (`convey-01`) that seats prints on a carrier plate;
- bond (`press-01`), finish (`cut-01`) and optical inspect (`inspect-01`);
- a person at `inspector`, where every route ends.

Each machine has a `queueDepth` of 4, so a burst of orders waits in the role queues instead of overfilling a machine.

[`route-manifests.json`](route-manifests.json) runs it two ways:

| Manifest | Stations |
|---|---|
| `automated` | `print-01` → `convey-01` → `press-01` → `cut-01` → `inspect-01` → person at `inspector` |
| `manual` | `print-02` → person at `harvester` (takes the prints off the plate, bags them) → `bonder` → `finisher` → `inspector` |

Both are the same `machineUnitRoute` workflow walking a list of stations. Each hop parks one handoff row on the receiving station's role and waits for it:
- On a machine's role, the gateway dispatches, claims and resolves the row as the machine.
- On a person's role, someone resolves it on the dashboard.

Minting one manifest or the other per order is all it takes to run a share of orders automated.

```
 workflow            Long Tail rows                 gateway                  machines
 ────────            ──────────────                 ───────                  ────────
 handoff(cut) ─────▶ row: line-trim  ──created──▶  dispatch ──cmd──────────▶ cut-01
                                                             ◀─cmd/reply──── accepted
                     claimed by cut-01   ◀──claim──
                     item released:U1    ◀──add────◀─job finished──────────── press-01
                     item arrived:U1     ◀──add────◀─job arrived───────────── cut-01
 ◀── received ────── resolved by cut-01  ◀─resolve─
```

A handoff that ends without a receipt (refusal, no reply, jam, wrong carrier, unreadable id, reject, timeout) parks a `line-operator` row. Its `decisions` facet lists what the operator may choose:
- For a failure in the move itself, the units are still on the line: `retry` dispatches the same hop again as a new job, `manual` hands them to a person from where they stopped, and `scrap` ends the route.
- When the sender finished the units as reject, hold, scrap or rework, they are off the line for good: the row offers `manual` (a person takes them from the sender) and `scrap`. Any other answer gets a new row that says so.

## Run it

```bash
docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml up -d --build
npm run machine:line                      # every route automated
MIX=50 UNITS=8 npm run machine:line       # half automated, half manual, same factory
FAULT=jam npm run machine:line            # a jam at the first machine; the operator retries
```

The machines override adds:
- `machine-site`: development certificates, plus `site.conf`, `mosquitto.conf` and the broker ACL, all rendered from the line into the gitignored `deploy/machine-site/`;
- `site-nats`: JetStream for the line's topics, a server of its own;
- `machine-broker`: Mosquitto, MQTT 5 with client certificates, bridged into `site-nats`;
- `machine-mock`: the simulated line, with drills on `:8090`.

### Learned addresses

`docker-compose.machines-learned.yml`, layered on the machines override, runs the same factory on a line that learns its addresses:

```bash
docker compose -f docker-compose.yml -f docker-compose.nats.yml -f docker-compose.machines.yml \
  -f docker-compose.machines-learned.yml up -d --build
```

- Each mock machine speaks as its permanent address from [`factory-line-addresses.json`](factory-line-addresses.json), with a certificate whose common name is that address.
- `machine-site` renders `line.json`, the line as Long Tail knows it (stations only, `addressing: "learned"`), and an ACL of `pattern` rules on `%u`.
- Long Tail binds each station to the machine that claims it as its first messages arrive, and keeps the binding on the station's bot account. The driver and its drills run unchanged.

Long Tail runs the gateway in process. `--profile standalone-gateway` runs it as its own service over the HTTP API instead (`gateway/main.ts`). Adding the override to a stack that already ran needs `up -d --build -V` once, so the containers pick up the `mqtt` dependency. When a host port is taken, set `LT_NATS_PORT` and point the driver at it with `NATS_URL`.

The driver mints routes from either manifest and plays the people:
- At each person's station, it waits until the gateway has recorded the sender's release of every unit. It then takes the units off and receives them.
- It clears alarms as a technician.
- It decides failed handoffs as the operator (`DECIDE=retry|manual|scrap`).

`FAULT` is one of `jam`, `incomplete`, `carrier_mismatch`, `unreadable`, `stall`, `reject`, `hold`, `estop`, `offline`, and `FAULT_AT` picks the machine. At the end the driver reports each route's hops and, per manifest, how many routes completed and were received at the inspector.

## Layout

| Path | What it holds |
|---|---|
| [`factory-line.json`](factory-line.json), [`demo-line.json`](demo-line.json) | The factory, and the small three-machine line the tests use |
| [`factory-line-addresses.json`](factory-line-addresses.json) | Each factory station's machine address, for the learned-address run |
| [`route-manifests.json`](route-manifests.json), [`manifests.ts`](manifests.ts) | The two manifests, the roles people work, the even percentage split |
| [`workflows/`](workflows/) | `machineUnitRoute` and its pure route planning (machine and person steps); `machineCommand`, one step that asks a machine to start, stop, pause, resume or change over |
| [`site/setup.ts`](site/setup.ts) | Certificates and broker configuration for the compose run |
| [`mock/`](mock/) | The simulated line: machines speaking the generic protocol, with drills for jams, refusals, outages and restarts; [`mock/main.ts`](mock/main.ts) runs it as a process |
| [`gateway/main.ts`](gateway/main.ts) | The standalone gateway as a process |

The machinery itself ships in the package: `lib/machines` (protocol, codec, transports, streams, broker configuration) and `services/machines` (gateway, rows, roles, identities, the in-process surface, and an in-memory Long Tail for tests). The simulated line stays here, with the example.

Tests:
- unit tests in `tests/lib/machines/`, `tests/services/machines/` and `tests/examples/machine-line/`;
- the workflow on the real orchestrator in `tests/workflows/machine-unit-route.test.ts`;
- end to end against the machines override in `tests/integration/machine-line.test.ts`.
