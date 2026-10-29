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

For each line, one replica leads (a Postgres advisory lock held on its own connection), makes sure the line's bot accounts exist, and runs the gateway. Other replicas wait on the lock and take over when the leader's session ends. A replica whose connection drops or is refused, as while Postgres restarts, contends again every 5 seconds.

## The line

```json
{
  "siteId": "site-1",
  "lineId": "line-1",
  "roles": { "exit": "inspector", "operator": "line-operator", "receivers": ["harvester"] },
  "machines": [
    { "machineId": "bond-cell-1", "process": "bond", "role": "bond-cell", "carrier": "none",
      "cycleSec": 8, "queueDepth": 4, "recipes": { "RCP-BOND-A": ["2"] }, "allowedSoftware": ["1.4.0"] }
  ]
}
```

| Field | Meaning |
|---|---|
| `machines[].role` | The role whose handoff rows the machine resolves. Default `line-<process>` |
| `machines[].address` | The physical machine on the wire: its topic level, client id and certificate name, such as a permanent UUID that stays with the machine if it moves. Default `machineId`, which stays the station that rows, roles and routes name |
| `addressing` | `declared` (default): each address is `machines[].address`, or the station's id. `learned`: a station with no `address` learns it from the machine that claims it. See [Learned addresses](#learned-addresses) |
| `roles.exit` | The role of the person who receives units at the end of a route. Default `line-exit` |
| `roles.operator` | The role that gets failed handoffs, stopping alarms, and offline or quiet machines. Default `line-operator` |
| `roles.receivers` | Other roles of people who take units straight from a machine. Machine bots join these roles and the exit role, so they can record their releases on those rows |
| `machines[].allowedSoftware` | Versions the line accepts. A machine reporting another version is refused before any dispatch |
| `machines[].queueDepth` | Most jobs the machine is sent or holds at once. Unset: no limit. See [Pacing](#pacing) |
| `machines[].requireArtifact` | The machine needs a job file. A handoff with neither the job's `artifactUrl` and `artifactSha256` nor an `artifact` on every unit is refused before anything is sent |

`start({ machines })` declares the station, exit and operator roles unless `roles` already declares them; set `declareRoles: false` to own them all.

## Rows

A machine handoff is a row on the receiving machine's role (a handoff to a person goes on one of the line's receiver roles) whose metadata says what to move:

| Facet | Meaning |
|---|---|
| `siteId`, `lineId` | The line; a gateway acts only on its own line's rows |
| `units` | `[{ unitId, carrierId, artifact?, artifacts?, parameters? }]`: the units that move together; any of a route's units, all or some. A unit's `artifact` is its own file, such as a per-unit model, and `artifacts` its files when it has several; each is `{ url, sha256, id?, contentType?, sizeBytes? }`. Its `parameters` are its own settings |
| `jobId`, `senderJobId` | The receiver's job and the sender's. Each open handoff into a machine names its own job; a second open row naming the same job there resolves `dispatch-refused`. A row for some of a sender job's units still receives their releases, however the codec split that job |
| `fromMachine`, `toMachine` | Machine ids, or null for line entry and for a person |
| `recipeId`, `recipeVersion`, `process` | What the receiver runs |
| `artifactUrl`, `artifactSha256` | The job file, by reference |
| `parameters` | Settings for the job, sent to the machine as given. Long Tail does not read them; what they mean is between the host and its codec |
| `attempt` | Retry number |

The gateway dispatches to `toMachine` when the row is created, or, under a codec that dispatches on arrival, once every unit has arrived there. It claims the row as that machine once the machine accepts. It records each unit's release by the sender and each arrival at the receiver as items. It resolves the row as the receiver once every unit has arrived:

```typescript
{ received: true, receiver: 'cut-01', units: ['U1', 'U2'] }
```

When a handoff ends without every unit (a failure, a timeout, a cancel), the gateway withdraws only the jobs none of whose units reached the receiver, so nothing queued for an absent unit runs later. A job some of whose units already arrived is under way: it stays, and what happens to it is the workflow's next decision. A workflow that wants it stopped parks a `cancel` command row (see Commands).

`Machines.handoffProgress(units, items)` reads where a handoff's units stand from its items (a row's items, or `$accumulated` on a finished wait): `{ released, arrived, missing }`. A workflow reads it to decide what a split means for its own process.

On arrival dispatch, the units are already at the receiver, so its acceptance resolves the row the same way.

When the handoff ends without a receipt, the row resolves `{ received: false, errorCode, unitId?, reason?, detail }`:

| `errorCode` | Cause |
|---|---|
| `dispatch-refused` | The machine refused or failed the dispatch (mode, recipe, queue, artifact), or the machine requires an artifact and the row has none. The reason is in `detail` |
| `dispatch-failed` | The machine accepted the job, then could not prepare it (artifact, recipe). The reason is in `detail` |
| `no-reply` | No reply after every attempt with the same command id, and the machine's snapshot does not list the job, or it sent none (`detail` then says the state is unknown). A job the snapshot lists counts as accepted. The dispatch is cancelled, so a copy still queued for an absent machine never runs |
| `software-unsupported` | The machine runs a version the line does not allow |
| `sender-rejected` | The sender finished a unit as reject, hold, scrap or rework. Its reason is in `reason` and `detail` |
| `jam`, `incomplete-handshake`, `carrier-mismatch`, `unreadable-id` | The move between machines failed |
| `withdrawn` | The receiver gave the job back |

A row on a person's role resolves the same way, from the dashboard. A workflow can mix both in one route and never tell them apart.

### Traceability

When a sender finishes a unit, the gateway records the release on the row and, in the same statement, merges two facets into the row's metadata:

| Facet | Holds |
|---|---|
| `trace` | One entry per unit: `{ unitId, machineId, jobId, result, materials: [{ material, lot }] }` |
| `lots` | Every lot those units consumed, once each |

Both are containment-searchable, so the rows that used a lot, and with them the units, are one query: `GET /escalations?facets={"lots":["LOT-7"]}`. A unit's whole path is every handoff row whose `units` holds it. The sender's full finished record stays on the row as its `released:<unit>` item. A codec maps its own lot fields into `materials`.

### Job lifecycle on the row

With `MACHINE_LIFECYCLE=on`, while a machine works a job, the gateway notes the job's milestones as items on the open row that holds it, as the machine's bot:
- the dispatch into the machine, until its units arrive;
- after that, the handoff out of the machine.

| Item | When |
|---|---|
| `started:<unit>` | The machine reports `started` |
| `progress:<unit>:<step>` | `progress` crosses a step of `MACHINE_PROGRESS_STEP` percent (25 by default, so 25, 50 and 75); the row's `progress` facet holds the latest `{ percent, remainingSec, stage, detail, at }` |
| `stage:<unit>:<stage>` | `progress` names a `stage` the job has not reached before, for machines that report named steps rather than a percent |
| `paused:<alarm>:<raisedAt>` | A stopping alarm is raised at the machine (the alarm row still goes to the operator role) |
| `resumed:<alarm>:<raisedAt>` | The machine clears that alarm |

Every other progress message stays in the stream, so an hour-long job leaves a handful of items on its row. A row parked with a limit on its items (`accumulate: { max }`) gets no notes, so they never take a slot its units need. Off, the rows hold only their releases and arrivals. A machine whose job runs before its units arrive, such as a printer whose part exists only once the print finishes, reports the arrival at the end, and the whole job lands on the one row. A `progress` job event may carry `percent` (0 to 100), `remainingSec`, a `stage` name and a `detail` object.

### Decisions on a failed handoff

`Machines.handoffDecisions(errorCode)` gives a default set of decisions for a failed handoff. A failure in the move leaves the units on the line, so `retry`, `manual` and `scrap` all fit. Units the sender finished as not ok (`sender-rejected`) leave the line and never re-enter it, so only `manual` and `scrap` fit. After a `partial-arrival` (a timeout once only some units arrived) the units are split between two stations, and a retry of the same hop would ask the sender for units it no longer holds, so the default offers `manual` and `scrap`. A workflow is free to offer its own decisions instead, such as moving only the missing units on; the platform reports the facts and does not choose.

The example route's policy for a split: it stops the receiver's job with a `cancel` command row, then a person collects each group of units where it stopped.

A host whose rows already carry their own facets supplies a `HandoffRowAdapter`:

```typescript
const rows: Machines.HandoffRowAdapter = {
  openRows: () => [{ type: 'station-step' }],          // read when a replica takes the line
  toHandoff: (row) => row.type === 'station-step' ? { siteId: row.metadata.plant, /* ... */ } : null,
};
```

## Pacing

A machine with a `queueDepth` is sent no more jobs than that at once. A handoff beyond it waits in the machine's role queue, pending and unclaimed, the way work waits for a busy person. The oldest waiting row goes out when the machine has room, and a full machine holds back its later rows even when a smaller one would fit. A machine with nothing in hand always takes the next row, even one with more jobs than the depth.

A machine's load is every job it has been sent or still holds:
- rows dispatched into it;
- rows whose units still wait on it to move on;
- units that arrived and have not left.

A unit leaves when the machine releases it, when it arrives at the next machine, or when the machine's snapshot no longer lists its job. A replica taking the line reads every open row back before it sends anything, so pacing survives a restart.

## Commands

A host asks a machine to start, stop, pause, resume, change over or cancel a job (`cancel` needs `args.jobId`) by parking a `machine-command` row on the machine's role, from a workflow step or through the API, the way it asks a person for anything:

```typescript
const reply = await conditional<Machines.CommandResolution>(`changeover-${orderId}`, {
  ...Machines.commandRow(Machines.commandTarget(line, 'bond-cell-1'), 'changeover', { recipe: { id: 'RCP-BOND-B', version: '1' } }),
  timeout: '10m',
});
```

Asking a machine for a command takes the same access as parking any row on its role: write access to that role, or a workflow that parks the row. A command row on any other role resolves `unsupported`.

The gateway sends the command and resolves the row with the reply, as the machine that gave it:

```typescript
{ accepted: true, machineId: 'bond-cell-1', op: 'changeover', status: 'accepted', reason: 'changing over to RCP-BOND-B v1' }
```

| `status` | Meaning |
|---|---|
| `accepted` | The machine took the command |
| `refused`, `failed` | The machine said no; its reason is in `reason` (a changeover to a version it does not hold is refused) |
| `no-reply` | No reply after every attempt. The command expired at the end of the asking, so a copy that reaches the machine later is refused, never run |
| `unsupported` | Not a command a row may ask for, not a machine on this line, or a command the line's codec has no message for; nothing was sent |

A command is sent again, under the same `cmdId` and with the same arguments, by a gateway that takes over the line while its row is open. Its `expiresAt` counts in rounds of the asking from the row's creation; once a round has mostly passed, the command goes out as a new one, `<row>:command:r<n>`, never as an old one with changed arguments.

The example's `machineCommand` workflow is this one step.

## The wire

The gateway works in the generic line protocol. A codec translates:

```typescript
interface LineCodec {
  root: string;
  channels: { events: string[]; telemetry: string[]; commands: string[] };   // MQTT filters under each machine
  topicFor?(scope: { siteId?, lineId?, address? }, channel: string): string; // the topic layout; absent levels are +
  unitsPerDispatch: number | null;                        // 1: one dispatch per unit
  dispatchOn?: 'created' | 'arrival';                     // when a handoff's job goes out
  strict?: boolean;                                       // broken messages go to a person, never acted on
  snapshotOnStart?: boolean;                              // ask every machine for a snapshot on taking the line
  retainedAlarms?: boolean;                               // active alarms stay retained on the broker until they clear
  decode(topic: string, payload: string, retained?: boolean): Inspection[];
  encode(ident: MachineIdent, command: MachineCommand): WireMessage[];      // [] when the machines lack the command
  receipt?(ident: MachineIdent, messageIds: string[]): WireMessage[];       // for machines that keep an outbox
}
```

- `decode` may return several events for one message. That is how a codec infers a receipt from a different event when the machines report no arrival. `Machines.genericCodec({ root, receiptFrom: 'started' | 'bound' })` does this for the generic protocol.
- With `unitsPerDispatch: 1` the gateway sends one job per unit, claims the row once every job is accepted, and cancels the accepted jobs if any is refused.
- `topicFor` lays out the topics, for a protocol with its own levels (a direction before the machine, say). The layout begins with `{root}/{site}/{line}/`. The broker ACL and the stream subjects follow it. Without it the layout is `{root}/{site}/{line}/{address}/{channel}`.
- `dispatchOn: 'arrival'` is for machines that take work only for units they have scanned in. The job goes out once every unit of the row has arrived, and each unit carries the arrival event its receiver reported (`units[].arrival`), so `encode` can echo the receiver's own visit id.
- A reply is `accepted` (recorded), and a machine that prepares its jobs may later reply `completed` (ready) or `failed` under the same `cmdId`. A failure after acceptance ends the handoff as `dispatch-failed`. When no reply comes, the gateway asks the machine for its snapshot before deciding.
- `receipt` confirms the messages the gateway is done with, for machines that resend an event until it is confirmed. `decode` marks each such message with a `receiptId`. The ids go out per machine in batches of up to 100 after `MACHINE_RECEIPT_DELAY_MS`, including messages already applied. A message still waiting for its row is confirmed once it lands.
- `strict: true` holds a message with contract violations: it is confirmed, never acted on, and one `contract-violation` row shows it to the operator role. Without it, known fields are acted on and the violations are logged.
- An alarm body may name the catalog edition its code comes from, `catalog: { domain, key, version }`. The alarm row then carries it as a lookup ref, so the row reads the code's meaning as of that edition.
- Event channels go to the durable stream and telemetry channels are read live. A machine reads its commands on the command channels. The broker ACL is rendered from these channels, so a codec with its own topics gets its own ACL. Unknown body fields are allowed and known ones are checked. Payloads may be up to 256 KB.
- `snapshotOnStart: true` is for machines that keep no retained state and report only what changes. The gateway asks each machine for a snapshot once it takes the line, so it learns every machine's current job before it acts on a change.
- `retainedAlarms: true` says active alarms stay retained on the broker until they clear, as in the line protocol. A gateway taking the line then reads every active alarm back, and an alarm row whose alarm is missing has cleared. Without it, a machine's snapshot lists its active alarms (`alarms`), and an alarm row whose alarm a snapshot the machine sends no longer lists resolves `cleared`; a snapshot read back from the broker is never used for this, since it may be older than the alarms.
- A receiver that reads only the carrier may report `arrived`, or `transfer-failed` with `unreadable-id`, with `carrierId` and no `unitId` or `jobId`. The gateway finds the unit an open handoff into that machine carries on that carrier.
- Each command reaches `encode` with `attempt`, how many times this gateway has sent that `cmdId`, and `retry`, true when the machine may already have it: sent earlier, or its row existed before this gateway took the line. A protocol with a retransmission flag sets it from `retry`.
- When `encode` returns no messages, the machines have no such command. The gateway sends nothing and waits for nothing: a machine-command row resolves `unsupported`, and a cancel or snapshot the machines lack is logged as unsupported.

The generic protocol's topics are `{root}/{site}/{line}/{machine}/{channel}`. Every message is wrapped in `{ v, id, at, source, body }`.

| Channel | Purpose |
|---|---|
| `presence` (retained) | Birth and will, with the software version |
| `snapshot` (retained) | Mode, recipe, jobs, alarms, counters, boot id |
| `job` | Per unit: `queued`, `ready`, `arrived`, `bound`, `started`, `progress`, `finished`, `released`, `transfer-failed`, `withdrawn` |
| `alarm/<id>` (retained while active) | Raise, acknowledgement, clear (with who cleared it) |
| `telemetry` | Readings |
| `report/<name>` | Production, availability, inventory and other reporting, kept in the stream |
| `cmd` / `cmd/reply` | `dispatch`, `cancel`, `start`, `stop`, `pause`, `resume`, `changeover`, `ack-alarm`, `snapshot`; replies `accepted`, `completed`, `refused`, `failed`. Every command carries a `cmdId` (a repeat is answered, never run twice) and an expiry |

## Rows for people

| Row | Raised when | Resolved when |
|---|---|---|
| `line-alarm` | A stopping alarm (critical or emergency) is raised | The machine clears it (with who cleared it). If a person resolves it first, the gateway sends `ack-alarm` |
| `machine-offline` | Presence goes offline past a debounce | The machine is heard again |
| `machine-quiet` | A connected machine sends nothing for `MACHINE_QUIET_MS` | It is heard again |
| `contract-violation` | A strict codec decodes a message that breaks the contract. The row holds the raw message and the violations | A person resolves it |
| `machine-registration` | On a line that learns addresses, an address claims a station bound to another address, or an address bound to one station claims another | A person resolves it with `{ decision: 'approve' }`, which binds the station to the claimant, or `reject` |

A replica taking a line reads back its learned addresses, its open handoff, command, alarm, offline, quiet and registration rows, and each open handoff's arrivals, so the receiver holds those units again. It then reads the machines' retained state, so a clear or a return that happened while no gateway was listening still resolves its row. A machine that restarts with a new boot id gets its accepted jobs dispatched again under the same command ids. An alarm id reused with a new raise time counts as a new alarm.

## Topology and identity

```
 machines ──MQTT, TLS, client cert──▶ machine broker ──bridge──▶ NATS with JetStream
                                         (Mosquitto)              (Long Tail's messaging, or a site NATS)
                                              ▲                        ▲
                                              └── gateway (commands)    └── gateway (streams, read only)
```

- **Machines:** each machine logs in over MQTT 3.1.1 or 5 with its own certificate; the CN (`{site}-{line}-{address}`) is its username. The broker ACL lets it write only its own channels and read only its own commands. The line controller may command every machine on the line.
- **Durable streams:** the bridge carries the line's topics one way into NATS, where only the bridge may publish them. JetStream keeps `LINE_EVENTS` (30 days) and `LINE_TELEMETRY` (3 days). The gateway reads through a durable consumer, `<controller>-events`, and may publish only JetStream requests and acks for its own streams and consumer; it cannot delete or purge them.
- **Where the streams live:** by default in Long Tail's messaging ([events](events.md#messaging)), whose NATS server must run JetStream. The bridge then logs in to that server's edge account for the line (`Machines.edgeAccountFor`), which may publish only the line's subjects, so the edge reaches nothing of Long Tail's. With `MACHINE_SITE_NATS_URL`, the streams live instead in a NATS server of the site's own (`Machines.renderSiteConf`), and Long Tail's NATS stays inside Long Tail. Either way the gateway reads the same streams under the same consumer name.
- **Escalation events:** the gateway inside Long Tail reads them in process. A standalone gateway subscribes to them over Long Tail's messaging.
- **Commands:** the gateway publishes commands to the machine broker at QoS 1, so they queue for a machine that is away.
- **Bot accounts:** in Long Tail each machine is a bot account on its station and receiver roles, so `claimed_by` and `resolved_by` name the machine. The controller bot holds those roles and the operator role, and raises the operator rows. The bots are member accounts with no password, under names the line derives; the line will not start while a person's account holds one of those names.
- **Rows are the authority:** an escalation event only tells the gateway which row to look at. It reads the row back as the controller and acts on the stored role, status and metadata. A row on a role the controller does not hold, or an event its stored row contradicts, does nothing.
- **Roles carry the access:** dispatching to a machine or commanding one means parking a row on that machine's role, so Long Tail's role access decides who can. The gateway acts on a handoff into a machine only on that machine's role, and on a handoff to a person only on a receiver role. A row commands only the machine whose role it is on: cancelling a handoff withdraws the receiver's dispatch, and the sender's job is stopped only by a `cancel` command row on the sender's role.
- **Rendering:** `Machines.renderSiteConf`, `renderMosquittoConf` and `renderMosquittoAcl(line, codec)` render the configuration from the line; the ACL takes its topics from the codec's channels.
- **Machines that host their own broker:** the machine broker connects out to each machine's broker with a Mosquitto bridge, carrying the machine's messages in and its commands out under the machine's level of the line's topics, and its codec reads them there. The bridge's notification topic, kept on the machine broker, is the machine's presence. `examples/workflows/bambu-printer` does this for 3D printers.

### Learned addresses

A line with `addressing: 'learned'` names its stations and lets each machine tell it who it is, so a machine can be commissioned, moved or replaced without editing the line.

- **The claim:** every message carries the machine's address (its topic level, which the broker ties to its certificate) and the station it says it is. A codec reports that station as the inspection's `claim`; the line protocol carries it as the envelope's `source.station`.
- **First contact binds:** a station with no address yet is bound to the first address that claims it. The gateway logs it, keeps it in its `AddressBook`, and sends the station's waiting work. Until then, handoffs into the station wait in its role queue, and command rows for it resolve `unsupported`.
- **A person settles a disagreement:** a claim on a station already bound to another address, or by an address bound to another station, raises one `machine-registration` row on the operator role. The claimant's messages have no effect, and get no receipt, until a person approves it. Approval binds only a claim the gateway has heard from that address since it took the line, for a station that learns its address; any other approval is logged (`machine_gateway.address.refused`) and changes nothing, and the claimant's next message raises a new row.
- **Where bindings live:** in process, on each station's bot account as the user property `machineAddress`; `MemoryAddressBook` otherwise. A replica taking the line reads them back before it sends anything.
- **Broker access:** stations that learn their address get no broker user of their own. `renderMosquittoAcl` writes `pattern` rules on `%u`, so every certificate may use the channels under its own name; each machine's certificate common name must therefore be its address.
- **Mixed lines:** a station that declares `address` on a learning line keeps it; claims on that station are ignored, and the gateway knows it only on its declared address. `renderMosquittoAcl` denies that station's channels to a certificate named for its address, which the `pattern` rules would otherwise grant.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `MACHINE_TRANSPORT` | | `nats` (durable streams) or `mqtt` (any MQTT broker, no replay beyond the session) |
| `MACHINE_ESCALATION_FEED` | `in-process` inside Long Tail, `core` for a standalone gateway | Where escalation events come from; `core` subscribes over Long Tail's messaging, or to `NATS_URL` with `NATS_TOKEN` when the gateway has none |
| `MACHINE_TOPIC_ROOT` | `line/v1` | The generic codec's root |
| `MACHINE_LINE_CONFIG` | | Path of the line JSON |
| `MACHINE_SITE_NATS_URL`, `_USER`, `_PASSWORD` | | A site NATS of its own for the streams; unset, `nats` keeps them in Long Tail's messaging |
| `MACHINE_MQTT_URL`, `_PROTOCOL` | `_PROTOCOL` 5 | Machine broker, for commands and retained reads; 4 for a broker that speaks only MQTT 3.1.1 |
| `MACHINE_MQTT_CA`, `_CERT`, `_KEY` | | TLS files; `{clientId}` in a path picks each identity's certificate |
| `MACHINE_REPLY_TIMEOUT_MS` | `5000` | Wait for a command reply |
| `MACHINE_DISPATCH_ATTEMPTS` | `3` | Tries per command before giving up |
| `MACHINE_DISPATCH_TTL_MS` | `600000` | How long a dispatch stays valid at the machine |
| `MACHINE_OFFLINE_DEBOUNCE_MS` | `15000` | Offline this long before a row |
| `MACHINE_QUIET_MS` | `90000` | Silent this long before a row; `0` turns it off |
| `MACHINE_RECEIPT_DELAY_MS` | `250` | How long confirmed message ids gather before a receipt goes out |
| `MACHINE_LIFECYCLE` | `off` | `on` notes each job's start, progress steps and pauses on the row that holds it |
| `MACHINE_PROGRESS_STEP` | `25` | With lifecycle notes on, progress is noted each time it crosses this many percent; `0` notes none |
| `MACHINE_CODEC_MODULE` | | Development server only: a module whose `createCodec(line)` speaks the machines' protocol |

## Testing a codec or adapter

A host proves its codec and row adapter against the real gateway in memory. The package provides the in-memory transports (`Machines.MemoryBroker`, `MemoryMachineBus`, `MemoryEscalationFeed`), and `@hotmeshio/long-tail/build/services/machines/testing` provides an in-memory Long Tail (`FakeLongTail`, with claim rules and simulated outages), a recording log and `until`. The test plays the machine: it answers the commands the gateway sends and publishes the messages a machine would, for example ones captured from a real machine or a simulator.

```typescript
import { Machines } from '@hotmeshio/long-tail';
import { FakeLongTail, until } from '@hotmeshio/long-tail/build/services/machines/testing';

const line = Machines.loadLine('./line.json');
const codec = myCodec;

// 1. Broker, escalation feed, Long Tail and the gateway, all in memory
const broker = new Machines.MemoryBroker({ redeliverMs: 5 });
const feed = new Machines.MemoryEscalationFeed(broker);
const lt = new FakeLongTail(feed);
const gateway = new Machines.MachineGateway({
  bus: new Machines.MemoryMachineBus(broker, Machines.lineFilter(codec.root, line.siteId, line.lineId)),
  feed, lt, line, codec, rows: myRows,
  settings: { topicRoot: codec.root, replyTimeoutMs: 50, dispatchAttempts: 2, offlineDebounceMs: 10, dispatchTtlMs: 60_000, quietMs: 0 },
});
await gateway.start();

// 2. Play the machine: see what the gateway sends, answer as the machine would
broker.connect('bond-cell-1');
broker.subscribe('bond-cell-1', myCommandTopic('bond-cell-1'), (msg) => broker.publish(myReplyTopic, myAcceptedReply(msg)));

// 3. Park a row the way a workflow step would, publish the machine's report, read the outcome
const row = lt.parkRow({ type: 'station-step', role: 'bond-cell', metadata: { /* the host's own facets */ } });
await until(() => lt.rows.get(row.id)?.assigned_to === 'bond-cell-1', 2_000);
broker.publish(capturedArrival.topic, capturedArrival.payload);
expect((await lt.ended(row.id)).resolver_payload).toMatchObject({ received: true, receiver: 'bond-cell-1' });
```

The same rig covers the unhappy paths: cut the machine off the network for `no-reply`, drop only its replies to see the snapshot keep the job, answer with a refusal for `dispatch-refused`, publish a not-ok finish for `sender-rejected`, or stop and start the gateway to prove a takeover reads its rows back.
