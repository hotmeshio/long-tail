# Machines as resolvers

A workflow step parks an escalation row and waits. A person resolves it on the dashboard, an API caller resolves it over HTTP, and with the machine surface a machine resolves it over MQTT. The row, the wait and the result are the same in every case. By the time the row resolves, the protocol has been turned into data on the escalation, the same way a form submission is.

This page is the contract for a host. A runnable factory lives in [examples/workflows/machine-line](../examples/workflows/machine-line/README.md).

## Declaration

```typescript
import { start, Machines } from '@hotmeshio/long-tail';

await start({
  // ...database, workers, roles
  machines: {
    lines: [Machines.loadLine('/etc/line.json')],
    codec: myCodec,     // optional: the machines' wire protocol (default: the generic line protocol)
    rows: myRows,       // optional: how your rows read as handoffs (default: the standard handoff facets)
  },
});
```

Transports come from the environment (see [Configuration](#configuration)). `mqtt` is an optional peer dependency; install it in the host when a line runs.

For each line, one replica leads (a Postgres advisory lock held on its own connection), makes sure the line's bot accounts exist, and runs the gateway. Other replicas wait on the lock and take over when the leader's session ends.

## The line

```json
{
  "siteId": "site-1",
  "lineId": "line-1",
  "roles": { "exit": "inspector", "operator": "line-operator", "receivers": ["harvester"] },
  "machines": [
    { "machineId": "bond-cell-1", "process": "bond", "role": "bond-cell", "carrier": "none",
      "cycleSec": 8, "recipes": { "RCP-BOND-A": ["2"] }, "allowedSoftware": ["1.4.0"] }
  ]
}
```

| Field | Meaning |
|---|---|
| `machines[].role` | The role whose handoff rows the machine resolves. Default `line-<process>` |
| `roles.exit` | The role of the person who receives units at the end of a route. Default `line-exit` |
| `roles.operator` | The role that gets failed handoffs, stopping alarms, and offline or quiet machines. Default `line-operator` |
| `roles.receivers` | Other roles of people who take units straight from a machine. Machine bots join these roles and the exit role, so they can record their releases on those rows |
| `machines[].allowedSoftware` | Versions the line accepts. A machine reporting another version is refused before any dispatch |

`start({ machines })` declares the station, exit and operator roles unless `roles` already declares them; set `declareRoles: false` to own them all.

## Rows

A machine handoff is a row on the receiving station's role whose metadata says what to move:

| Facet | Meaning |
|---|---|
| `siteId`, `lineId` | The line; a gateway acts only on its own line's rows |
| `units` | `[{ unitId, carrierId }]`: the units that move together |
| `jobId`, `senderJobId` | The receiver's job and the sender's |
| `fromMachine`, `toMachine` | Machine ids, or null for line entry and for a person |
| `recipeId`, `recipeVersion`, `process` | What the receiver runs |
| `artifactUrl`, `artifactSha256` | The job file, by reference |
| `attempt` | Retry number |

The gateway dispatches to `toMachine` when the row is created. It claims the row as that machine once the machine accepts. It records each unit's release by the sender and each arrival at the receiver as items. It resolves the row as the receiver once every unit has arrived:

```typescript
{ received: true, receiver: 'cut-01', units: ['U1', 'U2'] }
```

When the handoff ends without a receipt, the row resolves `{ received: false, errorCode, unitId?, reason?, detail }`:

| `errorCode` | Cause |
|---|---|
| `dispatch-refused` | The machine refused or failed the dispatch (mode, recipe, queue, artifact). The reason is in `detail` |
| `no-reply` | No reply after every attempt with the same command id. The dispatch is then cancelled, so a copy still queued for an absent machine never runs |
| `software-unsupported` | The machine runs a version the line does not allow |
| `sender-rejected` | The sender finished a unit as reject, hold, scrap or rework. Its reason is in `reason` and `detail` |
| `jam`, `incomplete-handshake`, `carrier-mismatch`, `unreadable-id` | The move between machines failed |
| `withdrawn` | The receiver gave the job back |

A row on a person's role resolves the same way, from the dashboard. A workflow can mix both in one route and never tell them apart.

A host whose rows already carry their own facets supplies a `HandoffRowAdapter`:

```typescript
const rows: Machines.HandoffRowAdapter = {
  openRows: () => [{ type: 'station-step' }],          // read when a replica takes the line
  toHandoff: (row) => row.type === 'station-step' ? { siteId: row.metadata.plant, /* ... */ } : null,
};
```

## The wire

The gateway works in the generic line protocol. A codec translates:

```typescript
interface LineCodec {
  root: string;
  channels: { events: string[]; telemetry: string[] };   // MQTT filters under each machine
  unitsPerDispatch: number | null;                        // 1: one dispatch per unit
  decode(topic: string, payload: string, retained?: boolean): Inspection[];
  encode(ident: MachineIdent, command: MachineCommand): WireMessage[];
}
```

- `decode` may return several events for one message. That is how a codec infers a receipt from a different event when the machines report no arrival. `Machines.genericCodec({ root, receiptFrom: 'started' | 'bound' })` does this for the generic protocol.
- With `unitsPerDispatch: 1` the gateway sends one job per unit, claims the row once every job is accepted, and cancels the accepted jobs if any is refused.
- Event channels go to the durable stream and telemetry channels are read live. Unknown body fields are allowed and known ones are checked. Payloads may be up to 256 KB.

The generic protocol's topics are `{root}/{site}/{line}/{machine}/{channel}`. Every message is wrapped in `{ v, id, at, source, body }`.

| Channel | Purpose |
|---|---|
| `presence` (retained) | Birth and will, with the software version |
| `snapshot` (retained) | Mode, recipe, jobs, alarms, counters, boot id |
| `job` | Per unit: `queued`, `ready`, `arrived`, `bound`, `started`, `progress`, `finished`, `released`, `transfer-failed`, `withdrawn` |
| `alarm/<id>` (retained while active) | Raise, acknowledgement, clear (with who cleared it) |
| `telemetry` | Readings |
| `report/<name>` | Production, availability, inventory and other reporting, kept in the stream |
| `cmd` / `cmd/reply` | `dispatch`, `cancel`, `enable`, `disable`, `ack-alarm`, `snapshot`; replies `accepted`, `refused`, `failed`. Every command carries a `cmdId` (a repeat is answered, never run twice) and an expiry |

## Rows for people

| Row | Raised when | Resolved when |
|---|---|---|
| `line-alarm` | A stopping alarm (critical or emergency) is raised | The machine clears it (with who cleared it). If a person resolves it first, the gateway sends `ack-alarm` |
| `machine-offline` | Presence goes offline past a debounce | The machine is heard again |
| `machine-quiet` | A connected machine sends nothing for `MACHINE_QUIET_MS` | It is heard again |

A replica taking a line reads back its open handoff, alarm, offline and quiet rows. It then reads the machines' retained state, so a clear or a return that happened while no gateway was listening still resolves its row. A machine that restarts with a new boot id gets its accepted jobs dispatched again under the same command ids. An alarm id reused with a new raise time counts as a new alarm.

## Topology and identity

```
 machines ──MQTT 5, TLS, client cert──▶ machine broker ──bridge──▶ site NATS ──leafnode──▶ Long Tail NATS
                                         (Mosquitto)               JetStream
                                              ▲                        ▲
                                              └── gateway (commands)    └── gateway (streams)
```

- **Machines:** each machine logs in with its own certificate; the CN is its username. The broker ACL lets it write only its own channels and read only its own commands. The line controller may command every machine on the line.
- **Durable streams:** the bridge carries the line's topics into the site NATS. There JetStream keeps `LINE_EVENTS` (30 days) and `LINE_TELEMETRY` (3 days); Long Tail's escalation events arrive over the leafnode into `LINE_LT_EVENTS` (7 days). The gateway reads both through durable consumers.
- **Commands:** the gateway publishes commands to the machine broker at QoS 1, so they queue for a machine that is away.
- **Bot accounts:** in Long Tail each machine is a bot account on its station roles, so `claimed_by` and `resolved_by` name the machine. The controller bot raises the operator rows.
- **Rendering:** `Machines.renderSiteConf`, `renderMosquittoConf` and `renderMosquittoAcl` render the configuration from the line.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MACHINE_TRANSPORT` | | `nats` (site NATS streams) or `mqtt` (any MQTT broker, no replay beyond the session) |
| `MACHINE_ESCALATION_FEED` | `jetstream` on nats, `in-process` on mqtt | Where escalation events come from |
| `MACHINE_TOPIC_ROOT` | `line/v1` | The generic codec's root |
| `MACHINE_LINE_CONFIG` | | Path of the line JSON |
| `MACHINE_SITE_NATS_URL`, `_USER`, `_PASSWORD` | | Site NATS for the streams |
| `MACHINE_MQTT_URL`, `_PROTOCOL` | `_PROTOCOL` 5 | Machine broker, for commands and retained reads; 4 for a broker that speaks only MQTT 3.1.1 |
| `MACHINE_MQTT_CA`, `_CERT`, `_KEY` | | TLS files; `{clientId}` in a path picks each identity's certificate |
| `MACHINE_REPLY_TIMEOUT_MS` | `5000` | Wait for a command reply |
| `MACHINE_DISPATCH_ATTEMPTS` | `3` | Tries per command before giving up |
| `MACHINE_DISPATCH_TTL_MS` | `600000` | How long a dispatch stays valid at the machine |
| `MACHINE_OFFLINE_DEBOUNCE_MS` | `15000` | Offline this long before a row |
| `MACHINE_QUIET_MS` | `90000` | Silent this long before a row; `0` turns it off |

## Testing a codec or adapter

`@hotmeshio/long-tail/build/services/machines/testing` provides the testing kit:
- an in-memory broker with retained messages, wills, offline queues and a durable log;
- a mock line of machines speaking the generic protocol, with drills for jams, refusals, outages and restarts;
- an in-memory Long Tail with claim rules and simulated outages;
- a recording log.

A host can drive its codec and row adapter against the gateway entirely in memory.
