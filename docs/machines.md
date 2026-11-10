# Machines as resolvers

A workflow step parks an escalation row and waits. A person resolves it on the dashboard, an API caller resolves it over HTTP, and with the machine surface a machine resolves it over MQTT. The row, the wait and the result are the same in every case. By the time the row resolves, the protocol has been turned into data on the escalation, the same way a form submission is.

This page is the contract for a host. A runnable factory lives in [examples/workflows/machine-line](../examples/workflows/machine-line/README.md).

## Declaration

Lines are declared two ways, and both land in one registry (`lt_machine_lines`) that every replica reads: in code, through `start({ machines })`, and through the API, `PUT /api/machines/lines/:siteId/:lineId`.

```typescript
import { start, Machines } from '@hotmeshio/long-tail';

await start({
  // ...database, workers, roles
  machines: {
    lines: [Machines.loadLine('/etc/line.json')],   // code lines; [] when every line comes through the API
    codec: myCodec,     // optional: the machines' wire protocol (default: the generic line protocol)
    codecs: { 'site-1/line-2': otherCodec },   // optional: a codec of its own for one line
    rows: myRows,       // optional: how your rows read as handoffs (default: the standard handoff facets)
  },
});
```

`codec` is the protocol every line speaks; `codecs` gives one line a protocol of its own, keyed `<siteId>/<lineId>`, so a print farm and a finishing line on different protocols run on one surface. A line declared through the API runs on `codec` unless `codecs` names it. Transports come from the environment (see [Configuration](#configuration)). `mqtt` is an optional peer dependency; install it in the host when a line runs. Declaring `machines` opens the dashboard's [Lines view](#lines-view), with or without code lines.

The registry keeps each line's definition, who declared it (`source`: `code` or `api`), and a `version` that advances once per change. Ownership follows `configSource`, as roles do:

- `db` (the default): a code line is inserted when absent and left as it is afterwards; a declaration that differs from the row is logged as drift and the row stands.
- `code`: a code line is written whenever its declaration differs, advancing the version once; the row then matches the code again.

Boot applies the code lines under these rules, logs one report (applied, unchanged, db-owned, and code lines the registry still holds that code no longer declares), then runs every enabled line the registry holds, code and API alike. Boot never deletes a line: a line leaves the registry only through `DELETE /api/machines/lines/:siteId/:lineId`. An API declaration applies the line's station, exit and operator roles where none exist (the host's own role declarations win), runs the line on the replica that took the request, and publishes `machine.line.<site>.<line>.declared`; every other replica reads the row back and runs it too. Retiring a line publishes `machine.line.<site>.<line>.retired` and each replica stops it; the line's roles and bot accounts stay.

The registry is Long Tail's side of a line. The site's side, its broker's certificates and ACL and its NATS permissions, is rendered from the lines it serves (see [Topology and identity](#topology-and-identity)); a line declared through the API leads only once the site knows it too. Until then the replica stands by and logs `machine_gateway.line.leadership_lost` with the broker's refusal, and the registry row waits.

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
| `roles.operator` | The role that gets failed handoffs, stopping alarms, and offline or quiet machines. Default `line-operator`. A workflow that parks its own failure decisions reads it too: `machineUnitRoute` takes it as `operatorRole` |
| `roles.quality` | The role that decides units a machine finished on hold: release, rework or scrap. Default `line-quality` |
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
| `units` | `[{ unitId, carrierId, artifact?, artifacts?, parameters?, refs? }]`: the units that move together; any of a route's units, all or some. A unit's `artifact` is its own file, such as a per-unit model, and `artifacts` its files when it has several; each is `{ url, sha256, id?, contentType?, sizeBytes? }`. Its `parameters` are its own settings and its `refs` its own references |
| `jobId`, `senderJobId` | The receiver's job and the sender's. Each open handoff into a machine names its own job; a second open row naming the same job there resolves `dispatch-refused`. A row for some of a sender job's units still receives their releases, however the codec split that job |
| `fromMachine`, `toMachine` | Machine ids, or null for line entry and for a person |
| `recipeId`, `recipeVersion`, `process` | What the receiver runs |
| `artifactUrl`, `artifactSha256` | The job file, by reference |
| `parameters` | Settings for the job, sent to the machine as given. Long Tail does not read them; what they mean is between the host and its codec |
| `refs` | The host's references for the job by name, `{ orderId: 'ORD-9', batch: 'B-2' }`: string values only, others are dropped. Sent with the dispatch as `refs` (and each unit's as `units[].refs`) and containment-searchable on the row: `GET /escalations?facets={"refs":{"orderId":"ORD-9"}}` |
| `attempt` | Retry number |

The gateway dispatches to `toMachine` when the row is created, or, under a codec that dispatches on arrival, once every unit has arrived there. It claims the row as that machine once the machine accepts. It records each unit's release by the sender and each arrival at the receiver as items. It resolves the row as the receiver once every unit has arrived:

```typescript
{ received: true, receiver: 'cut-01', units: ['U1', 'U2'] }
```

When a handoff ends without every unit (a failure, a timeout, a cancel), the gateway withdraws only the jobs it sent whose units never reached the receiver, so nothing queued for an absent unit runs later; a job that never went out, because the row was waiting for room or for its units to arrive, leaves the receiver nothing to withdraw. A job some of whose units already arrived is under way: it stays, and what happens to it is the workflow's next decision. A workflow that wants it stopped parks a `cancel` command row (see Commands).

`Machines.handoffProgress(units, items)` reads where a handoff's units stand from its items (a row's items, or `$accumulated` on a finished wait): `{ released, arrived, missing }`. A workflow reads it to decide what a split means for its own process.

On arrival dispatch, the units are already at the receiver, so the row resolves `received` once the machine has the job: at its acceptance, or, when the acceptance says `preparing: true`, at the `completed` reply that follows, however soon after the acceptance it comes; a `failed` reply meanwhile ends the row `dispatch-failed`. A gateway taking the line over resolves such a row at once if the machine's snapshot holds the job, since the reply it waited for may have passed. A new row for units the machine already holds from an earlier attempt (a job it failed to prepare, then the operator's retry) is dispatched at once with the arrivals the gateway kept, so the units are not scanned in twice. The job then runs with its row ended; the gateway that sent it remembers the row for as long as the machine holds the job's units, so a machine that restarts with the job unfinished is sent it again from that row (the same command id and issue time while the validity round lasts, flagged as a retry), with no verb on the row. A gateway that took the line after the row ended remembers nothing of the job: a restart then logs `machine_gateway.dispatch.unrecoverable` with the jobs the machine lost, and the next hop's row times out as its route decides.

When the handoff ends without a receipt, the row resolves `{ received: false, errorCode, unitId?, result?, reason?, detail, code? }`. `detail` is text for a person; `code` is the machine's structured code when its reply carried one, so a workflow can branch on it:

| `errorCode` | Cause |
|---|---|
| `dispatch-refused` | The machine refused or failed the dispatch (mode, recipe, queue, artifact), or the machine requires an artifact and the row has none. The reason is in `detail`, and `code` is the reply's code when it had one |
| `dispatch-failed` | The machine accepted the job, then could not prepare it (artifact, recipe). The reason is in `detail`, and `code` is the reply's code when it had one |
| `no-reply` | No reply after every attempt with the same command id, and the machine's snapshot does not list the job, or it sent none (`detail` then says the state is unknown). A job the snapshot lists counts as accepted. The dispatch is cancelled, so a copy still queued for an absent machine never runs |
| `software-unsupported` | The machine runs a version the line does not allow |
| `sender-rejected` | The sender finished a unit as reject, hold, scrap or rework; `result` says which. Its reason is in `reason` and `detail` |
| `jam`, `incomplete-handshake`, `carrier-mismatch`, `unreadable-id` | The move between machines failed |
| `withdrawn` | The receiver gave the job back |

A row on a person's role resolves the same way, from the dashboard. A workflow can mix both in one route and never tell them apart.

### Traceability

When a sender finishes a unit, the gateway records the release on the row and, in the same statement, merges two facets into the row's metadata:

| Facet | Holds |
|---|---|
| `trace` | One entry per unit: `{ unitId, machineId, jobId, result, materials: [{ material, lot }] }` |
| `lots` | Every lot those units consumed, once each |

Both are containment-searchable, so the rows that used a lot, and with them the units, are one query: `GET /escalations?facets={"lots":["LOT-7"]}`. A unit's whole path is every handoff row whose `units` holds it. The sender's full finished record stays on the row as its `released:<unit>` item. When that record is not ok, the row is first claimed for the machine that resolves it, so the record and the `sender-rejected` resolution land on a row no receiver can end in between. A codec maps its own lot fields into `materials`.

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

`Machines.handoffDecisions(errorCode)` gives a default set of decisions for a failed handoff. A failure in the move leaves the units on the line, so `retry`, `manual` and `scrap` all fit. Units the sender finished as not ok (`sender-rejected`) leave the line and never re-enter it, so only `manual` and `scrap` fit; units finished on hold (`result: hold`) are the exception, and the example route asks the quality role instead (`Machines.HOLD_DECISIONS`: `release`, `rework`, `scrap`), sending the decision to the holding machine as the command the codec declares for it (`dispositionOp`) when it declares one. After a `partial-arrival` (a timeout once only some units arrived) the units are split between two stations, and a retry of the same hop would ask the sender for units it no longer holds, so the default offers `manual` and `scrap`. A workflow is free to offer its own decisions instead, such as moving only the missing units on; the platform reports the facts and does not choose.

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

A unit leaves when the machine releases it, when it arrives at the next machine, or when the machine's snapshot no longer lists its job. A replica taking the line reads every open row back before it sends anything, so pacing survives a restart; a handoff row that was never given items, one parked by hand on a machine's role, reads as holding none.

## Commands

A host asks a machine to start, stop, pause, resume, change over, cancel a job (`cancel` needs `args.jobId`), report a `snapshot`, or do anything its codec declares (`rowOps`, see [The wire](#the-wire)) by parking a `machine-command` row on the machine's role, from a workflow step or through the API, the way it asks a person for anything. `stop` with `args.jobId` stops that job at a safe point and holds its units; without it, the machine finishes the current unit and takes no more:

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
| `refused`, `failed` | The machine said no; its reason is in `reason` (a changeover to a version it does not hold is refused), and `code` is the reply's structured code when it carried one |
| `no-reply` | No reply after every attempt. The command expired at the end of the asking, so a copy that reaches the machine later is refused, never run |
| `unsupported` | Not a command a row may ask for (a control op, `snapshot`, or one the codec declares), not a machine on this line, or a command the line's codec has no message for; nothing was sent |
| `sent` | A one-way command (`rowOps` entry `{ op, reply: false }`): published once, with nothing to wait for |

A `snapshot` row resolves with the reply like any command, and the machine's snapshot follows on its own channel; a dashboard or a workflow asks for a machine's state this way.

A command is sent again, under the same `cmdId` and with the same arguments, by a gateway that takes over the line while its row is open. Its `expiresAt` counts in rounds of the asking from the row's creation, and a round begins only once the one before it has expired; a command sent in a later round goes out as a new one, `<row>:command:r<n>`, never as an old one with changed arguments. Dispatches work the same way with `MACHINE_DISPATCH_TTL_MS`, counted from the row's creation, or for `dispatchOn: 'arrival'` from the last unit's arrival, so a machine never holds two valid commands for one row.

The example's `machineCommand` workflow is this one step.

A codec declares a command the machines never reply to as `{ op, reply: false }` in `rowOps`. Its row is sent once and resolves `sent` by the controller at once; it is never sent again and never expires.

## Requests

A machine may ask the host something: a material it was handed, a part it cannot place, a value only the host knows. Its codec marks the decoded message `answer: { op, ref?, role?, withinMs? }`, and the gateway parks one `machine-request` row for it, on `role` (the machine's own role by default). The row is created once per message, keyed by the machine and `ref` (the id the answer names: the codec's, else the message's receipt id, else its envelope id), so a redelivered or replayed message parks nothing new. The message is confirmed only once its row exists.

The row's metadata holds `siteId`, `lineId`, `machineId`, `op`, `ref`, `withinMs` and `event`, the message as the codec decoded it. Whoever decides adds the answer as the row's `answer` item: a workflow or an activity through the accumulate API, a scan step that accumulates into the row, an agent through `accumulate_item`, or a person in the row's items panel:

```typescript
const { itemKey, payload } = Machines.answerItem({ accepted: true, lot: 'LOT-7', quantity: 4 });
await lt.escalations.accumulate({ id: requestRowId, itemKey, payload });
```

The gateway sends the answer once, through `encode`, as the request's `op` (or the `op` the answer names, one a command row may ask for), with `respondingTo: ref` on the command, and resolves the row as the controller:

```typescript
{ answered: true, machineId: 'loader-1', op: 'material-ack', ref: 'm-81f3', status: 'sent', answeredBy: '<user id>' }
```

It waits for no reply. An answer the codec has no message for resolves `unsupported`. A request that someone resolves or cancels directly ends with no answer sent.

A request with `withinMs` still unanswered after that long raises one `machine-request-overdue` row on the line's operator role, naming the request. An answer added later is still sent, and the overdue row then resolves `answered`.

A gateway taking the line reads back the open requests and their overdue rows. A request that already holds its answer is answered at once; the others are watched again from their creation. A gateway that stops between sending an answer and resolving its row leaves the row open, and the next one sends the answer again with the same `respondingTo`, so the machine drops the duplicate.

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
  rowOps?: readonly (string | { op: string; reply?: boolean })[]; // the machines' own commands; reply: false sends once
  decode(topic: string, payload: string, retained?: boolean): Inspection[];
  encode(ident: MachineIdent, command: MachineCommand): WireMessage[];      // [] when the machines lack the command
  receipt?(ident: MachineIdent, messageIds: string[]): WireMessage[];       // for machines that keep an outbox
}
```

- `decode` may return several events for one message. That is how a codec infers a receipt from a different event when the machines report no arrival. `Machines.genericCodec({ root, receiptFrom: 'started' | 'bound' })` does this for the generic protocol.
- With `unitsPerDispatch: 1` the gateway sends one job per unit, claims the row once every job is accepted, and cancels the accepted jobs if any is refused.
- `topicFor` lays out the topics, for a protocol with its own levels (a direction before the machine, say). The layout begins with `{root}/{site}/{line}/`. The broker ACL and the stream subjects follow it. Without it the layout is `{root}/{site}/{line}/{address}/{channel}`.
- `dispatchOn: 'arrival'` is for machines that take work only for units they have scanned in. The job goes out once every unit of the row has arrived, and each unit carries the arrival event its receiver reported (`units[].arrival`), so `encode` can echo the receiver's own visit id.
- A reply is `accepted` (recorded), and a machine that prepares its jobs says so with `preparing: true` and later replies `completed` (ready) or `failed` under the same `cmdId`. A failure after acceptance ends the handoff as `dispatch-failed`. When no reply comes, the gateway asks the machine for its snapshot before deciding.
- `receipt` confirms the messages the gateway is done with, for machines that resend an event until it is confirmed. `decode` marks each such message with a `receiptId`. The ids go out per machine in batches of up to 100 after `MACHINE_RECEIPT_DELAY_MS`, including messages already applied. A message still waiting for its row is confirmed once it lands.
- `strict: true` holds a message with contract violations: it is confirmed, never acted on, and one `contract-violation` row shows it to the operator role. Without it, known fields are acted on and the violations are logged. A receiver's report that it read no id (`transfer-failed`, `failure: unreadable-id`, neither `unitId` nor `carrierId`) keeps the contract, so under a strict codec it reaches the operator as a `handoff-error` row rather than a violation.
- An alarm body may say `needsPerson: true`: the row is raised whatever the level, and the row's level stays the machine's. Stopping levels raise a row on their own.
- A snapshot needs only `mode`, `enabled`, `jobs` and `alarms`; `bootId`, `software`, `recipe` and `cycles` are read when present. A job event needs no `orderRef`; the row already knows its order. A codec for machines that spread these over several messages fills in what it has.
- An alarm body may name the catalog edition its code comes from, `catalog: { domain, key, version }`, with `version` an edition number or the label an edition carries (a catalog revision, say). The alarm row then carries it as a lookup ref, so the row reads the code's meaning as of that edition; a label no edition carries yet leaves the row's lookup unresolved, never the row uncreated.
- Event channels go to the durable stream and telemetry channels are read live. A machine reads its commands on the command channels. The broker ACL is rendered from these channels, so a codec with its own topics gets its own ACL. Unknown body fields are allowed and known ones are checked. Payloads may be up to 256 KB.
- `snapshotOnStart: true` is for machines that keep no retained state and report only what changes. The gateway asks each machine for a snapshot once it takes the line, so it learns every machine's current job before it acts on a change.
- `retainedAlarms: true` says active alarms stay retained on the broker until they clear, as in the line protocol. A gateway taking the line then reads every active alarm back, and an alarm row whose alarm is missing has cleared. Without it, a machine's snapshot lists its active alarms (`alarms`), and an alarm row whose alarm a snapshot the machine sends no longer lists resolves `cleared`; a snapshot read back from the broker is never used for this, since it may be older than the alarms.
- A receiver that reads only the carrier may report `arrived`, or `transfer-failed` with `unreadable-id`, with `carrierId` and no `unitId` or `jobId`. The gateway finds the unit an open handoff into that machine carries on that carrier.
- Each command reaches `encode` with `attempt`, how many times this gateway has sent that `cmdId`, `retry`, true when the machine may already have it (sent earlier, or its row existed before this gateway took the line), and `issuedAt`, when it was issued. `issuedAt` is the same on every send of a `cmdId`, by this gateway or the next: a dispatch or a command row takes the start of its validity round, any other command the time of its first send. A protocol with a retransmission flag sets it from `retry` and stamps its time from `issuedAt`, so a resend repeats the first attempt with only the flag changed; the generic envelope's `at` is `issuedAt`.
- When `encode` returns no messages, the machines have no such command. The gateway sends nothing and waits for nothing: a machine-command row resolves `unsupported`, and a cancel or snapshot the machines lack is logged as unsupported.
- `rowOps` names the machines' own commands, beyond the line protocol's control ops and `snapshot`, that a machine-command row may ask for. Each goes through `encode` with the row's `args` and the row resolves with the reply. An entry `{ op, reply: false }` is a command the machines never reply to: it is sent once and its row resolves `sent`. Every entry names a non-empty op; the gateway refuses to start on a codec whose entries do not.
- `decode` marks a message that asks the host for an answer with `answer: { op, ref?, role?, withinMs? }` (see [Requests](#requests)). The answer goes out through `encode` with `respondingTo` set to `ref`; the generic codec carries it in the command body.
- A reply may carry `code`, a string the machine chooses, beside its `reason` text. The gateway puts it on the row as `code`, on a command row's resolution and on a `dispatch-refused` or `dispatch-failed` handoff, so a workflow branches on the code and a person reads the reason.
- Presence may carry `sessionId`, one per connection, and `reason` on a goodbye. A presence with a new `sessionId` while the machine is online is a reconnect whose offline presence was never heard: the gateway asks for a snapshot, as it does when a machine comes back. An offline row records the `reason` the machine gave.

The generic protocol's topics are `{root}/{site}/{line}/{machine}/{channel}`. Every message is wrapped in `{ v, id, at, source, body }`.

| Channel | Purpose |
|---|---|
| `presence` (retained) | Birth and will, with the software version, a `sessionId` per connection, and on a goodbye the `reason` |
| `snapshot` (retained) | Mode, enabled, jobs and alarms; recipe, counters, software and boot id when the machine keeps them |
| `job` | Per unit: `queued`, `ready`, `arrived`, `bound`, `started`, `progress`, `finished`, `released`, `transfer-failed`, `withdrawn` |
| `alarm/<id>` (retained while active) | Raise, acknowledgement, clear (with who cleared it); `needsPerson: true` on an alarm of any level asks for a person |
| `telemetry` | Readings |
| `report/<name>` | Production, availability, inventory and other reporting, kept in the stream |
| `cmd` / `cmd/reply` | `dispatch`, `cancel`, `start`, `stop` (with `jobId`: that job, at a safe point), `pause`, `resume`, `changeover`, `ack-alarm`, `snapshot`; replies `accepted`, `completed`, `refused`, `failed`, with a `reason` and an optional `code`. Every command carries a `cmdId` (a repeat is answered, never run twice) and an expiry |

## Rows for people

| Row | Raised when | Resolved when |
|---|---|---|
| `line-alarm` | A stopping alarm (critical or emergency) is raised, or one the machine flags `needsPerson`, at the level the machine said | The machine clears it (with who cleared it). If a person resolves it first, the gateway sends `ack-alarm` |
| `machine-offline` | Presence goes offline past a debounce; the row's `reason` is the machine's, when its goodbye gave one | The machine is heard again |
| `machine-quiet` | A connected machine sends nothing for `MACHINE_QUIET_MS` | It is heard again |
| `contract-violation` | A strict codec decodes a message that breaks the contract. The row holds the raw message and the violations | A person resolves it |
| `handoff-error` (`unmatched-arrival`) | A machine reports an arrival no open handoff into it expects: a carrier no row carries, once every delivery has passed, or a read that found no id at all (`transfer-failed` with `failure: unreadable-id`, no unit, no carrier), at once. One row per machine and carrier, holding the raw arrival, so the unit is re-scanned or routed | A person resolves it; the next such arrival raises a row again |
| `quality-hold` | The example route's row for units a machine finished on hold (`sender-rejected` with `result: hold`), on the quality role | A person answers `release` (the hop runs again from the holding machine), `rework` with an optional `station` (the route runs again from that station), or `scrap` |
| `machine-request-overdue` | A machine request with `withinMs` is still unanswered after that long. One row per request, naming it | The request ends: answered, resolved or cancelled (`answered`) |
| `machine-registration` | On a line that learns addresses, an address claims a station bound to another address, or an address bound to one station claims another | A person resolves it with `{ decision: 'approve' }`, which binds the station to the claimant, or `reject` |

A replica taking a line reads back its learned addresses, its open handoff, command, request, alarm, offline, quiet and registration rows, and each open handoff's arrivals, so the receiver holds those units again. It then reads the machines' retained state, so a clear or a return that happened while no gateway was listening still resolves its row. A machine that restarts with a new boot id gets its accepted jobs dispatched again under the same command ids, and, from the gateway that sent them, the ready jobs of rows that already ended whose units it still holds; jobs it lost that no row and no memory covers are logged as unrecoverable. An alarm id reused with a new raise time counts as a new alarm.

## Lines view

The dashboard shows the lines under Monitor. The view exists only when `start({ machines })` runs a surface: `GET /api/settings`, which is public, then carries `machines: { declared: n }`, the number of lines this replica runs, and names no line; without a surface the key is absent and the dashboard shows no Lines entry. Reading the view takes the ops tier (superadmin, admin type, or engineer); declaring and retiring a line takes an administrator.

**The index** (`/lines`) lists every line in the registry with how it is right now, searched and paged on the server. Each row carries the site and line, the machines with any offline or quiet in the warning tone, active alarms, rows waiting on a person, work in flight (handoff and command rows), whether this replica leads it, and at wide widths the machine chain and the source with its version. Lines needing attention sort first; the order can also be site and line, or recently changed. The filter band searches site, line, machine ids, processes, roles and addresses, narrows to one site (the sites give the index its facet, each with its lines and how many need attention), and keeps only lines that need attention. Until a search or a site narrows the page, rows group under a heading per site. On a narrow container the table folds into console cards. A panel declares a line from a JSON definition, edits and saves one already declared (the version you edited is sent, and a newer one on the server refuses the save), and retires it after a confirmation inside the panel.

**A line** (`/lines/:siteId/:lineId`) shows its machines above and the wire beneath. The machines region lists the machines as tiles (presence ring, id, process and address, software, held units, open rows by kind, active alarms) or as rows (one dense line per machine in a list that scrolls within the region, with a search over id, process, role and address). The view picks itself by count, tiles up to twelve machines and rows beyond, and the choice can be overridden per line from the two icon buttons; "Needs attention" keeps only machines that are offline, quiet, alarmed or holding open rows. The wire is a boxed section beneath: its own filter band (machine, channel, direction, kind, violations only; folded behind one Filters button on a narrow container), the count shown and on the tape, pause (new arrivals wait while you read), clear, full screen, and "Watch on the event stream", which adds the line's wire to the shell's bottom event feed so the line stays watchable anywhere in the app. The tape keeps the newest two thousand events and scrolls inside its box; a row opens the event's record. Selecting a machine opens its panel and follows it on the tape until the chip beneath the band releases the filter. The panel holds the machine's last snapshot (address, software, since and last seen, boot and session ids, jobs, alarms, held units), its open rows with links, a timeline over a window of the rows that moved work to or from it, and three tools: ask for a snapshot (a `snapshot` command row), send a command (a control op, `snapshot`, or one the codec declares, with JSON args), and inspect a message (a dry run of a topic and payload, nothing applied). A replica standing by says so and keeps the tape live from the leader.

### The wire record

Every message a line's gateway reads, and every command, snapshot request and receipt it sends, is published as one event, `machine.wire.<site>.<line>.<machineId|unknown>.<in|out>` (on NATS `lt.events.machine.wire...`, tokens sanitized as escalation subjects are). The dashboard subscribes to `lt.events.machine.wire.<site>.<line>.>`. The event's `data` is the record:

```typescript
interface WireEvent {
  type: 'machine.wire'; siteId: string; lineId: string; machineId: string | null; address: string | null;
  direction: 'in' | 'out'; channel: string; topic: string; id: string | null; at: string; retained: boolean;
  kind: 'presence' | 'snapshot' | 'job' | 'alarm' | 'telemetry' | 'report' | 'cmd' | 'reply' | 'receipt' | 'unknown';
  event: string | null;    // job event, alarm raised/acked/cleared, command op, reply status, presence online/offline, snapshot mode
  summary: string;         // one line from the kind, the event and the ids the body names
  violations: string[];    // what the contract check found
  actions: { verb: 'claim' | 'accumulate' | 'resolve' | 'create-row' | 'refuse' | 'hold' | 'unmatched' | 'unreadable' | 'ack' | 'none'; rowId?: string; itemKey?: string; detail?: string }[];
  payload?: unknown;       // the raw wire payload; builders only, stripped before it reaches anyone else's browser
}
```

`actions` is what the gateway did with the message: the verbs it performed on rows, with the row ids (`claim`, `accumulate` with its `itemKey`, `resolve`, `create-row`), a verb Long Tail refused (`refuse`), a message held for a person under a strict codec (`hold`), one no row claimed after every delivery (`unmatched`; an arrival then goes to a person as a `handoff-error` row), one the codec or the planner could not read (`unreadable`), one admitted with nothing to do (`ack`), and `none` with a `detail` for everything else: a message waiting for its row, a dispatch or command that went out because of it (the send is its own `out` record), an address no station claims. A record of a message read back from the broker on taking the line says `retained: true`.

Telemetry messages are read live and are many: they join the wire record only with `MACHINE_WIRE_TELEMETRY=on`. The leader also keeps the line's last wire events in memory, readable over HTTP (`GET .../wire`, below), so a client outside the browser follows the tape without the event stream.

The gateway log is published the same way, `machine.log.<site>.<line>.<event>` with the entry's level and context, where `<event>` is the log event without its `machine_gateway.` prefix as one token (`dispatch-accepted`, `verb-row_not_visible`). The console log keeps every entry as before.

### Routes

| Route | Answer |
|---|---|
| `GET /api/machines/lines?q=&site=&attention=&sort=&limit=&offset=` | The index, `LineIndex`: one page of `LineIndexRow` (the `LineSummary` with its machines, process, role, address and the codec's `rowOps`; `source`, `version`, `enabled`, `updatedAt`; `leading` on this replica; and `health`: machines, and the pending rows counted as `offline`, `quiet`, `alarms`, `people` (handoff errors, contract violations, registrations), `handoff`, `command`, with `attention` when a machine is offline, an alarm is active or a person is needed), `total`, `sites` (every site with its lines and how many need attention), `limit`, `offset`. `q` searches site, line, machine ids, processes, roles and addresses (the first 200 characters count); `attention=true` keeps only lines that need it; `sort` is `attention` (default), `site` or `updated`, anything else 400; `limit` is 50 by default and 200 at most. 404 when `machines` is not declared at all |
| `PUT /api/machines/lines/:siteId/:lineId` `{ definition: LineDef, version? }` | Declares the line through the API (administrators): the definition is validated as `loadLine` validates a file and must name the site and line in the path, stored with `source: api`, its roles applied, and the line run on every replica. A `version` names the version the caller last read; a different one is 409. Answers `{ line: LineIndexRow }`; 400 names what the definition lacks, a version that is not a whole number, or a site or line that is not a topic level |
| `DELETE /api/machines/lines/:siteId/:lineId` | Retires the line (administrators): the registry row goes, every replica stops it, its roles and bot accounts stay. 204, or 404 when there is no such line or the path is not a site and line |
| `GET /api/machines/lines/:siteId/:lineId` | `LineViewResponse`: the `LineView` from the replica leading the line (`takenAt`, each machine's link with online, since, last seen, software, boot and session ids, held units with the rows they came in on, open row counts by kind with the offline and quiet row ids, alarms with their rows, the last snapshot's jobs, and the contested claims waiting for a person), or `{ siteId, lineId, leading: false }` from a replica standing by. Both carry `summary`, the `LineSummary` (machines, roles, addresses and the codec's ops), so the Lines view reads the line from any replica |
| `GET /api/machines/lines/:siteId/:lineId/wire?limit=&machine=&direction=&kind=&since=` | `LineWireResponse`: the line's last wire events from the replica leading it, newest first (`MACHINE_WIRE_WINDOW` of them kept, 500 by default and at most 500 per read), narrowed by machine, direction (`in`, `out`), kind and `since` (ISO 8601); builders read each event's `payload`, everyone else the record without it, as on the event stream. A replica standing by answers `leading: false` and no events. A test harness or a vendor's driver reads the tape here with a token and nothing else |
| `POST /api/machines/lines/:siteId/:lineId/inspect` `{ topic, payload, retained? }` | A dry run on the leader: what the codec reads (`kind`, `event`, `summary`, `inspections`, `violations`) and the actions the gateway would take, planned on a copy of its state. Nothing is applied and no row is created; 409 on a replica that is not leading |
| `POST /api/machines/lines/:siteId/:lineId/machines/:machineId/commands` `{ op, args }` | Parks a `machine-command` row on the machine's role as the caller, so that role's write access decides, and answers `{ rowId }`. `op` is a control op, `snapshot`, or one the codec declares (400 otherwise); an unknown machine is 404 |

Declaring a line from a shell:

```bash
curl -X PUT http://localhost:3000/api/machines/lines/site-2/line-1 \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"definition\": $(cat line.json)}"
curl "http://localhost:3000/api/machines/lines?q=press&attention=true" -H "authorization: Bearer $TOKEN"
curl -X DELETE http://localhost:3000/api/machines/lines/site-2/line-1 -H "authorization: Bearer $TOKEN"
```

Each replica answers the index and the line's summary; only the leader of a line holds its state. A request-reply to the leader, so any replica can serve the live view and the dry run, and a per-line runtime switch for telemetry on the wire are the next steps.

### MCP

The built-in `long-tail-machines` server offers the same surface to agents, gated as the routes are: `list_machine_lines` (the index with health, search, site and attention filters, sort and paging; `declared: false` without a surface), `get_machine_line` (one line as its leader sees it or standing by, with its summary and command ops), `inspect_machine_message` (the dry run), `send_machine_command` (parks a `machine-command` row on the machine's role as the caller), and for administrators `declare_machine_line` (versioned; a stale version is a conflict) and `retire_machine_line`. Read-scoped callers see the three reads only. See [MCP](mcp.md#machines-server).

## Topology and identity

```
 machines ──MQTT, TLS, client cert──▶ machine broker ──bridge──▶ NATS with JetStream
                                         (Mosquitto)              (Long Tail's messaging, or a site NATS)
                                              ▲                        ▲
                                              └── gateway (commands)    └── gateway (streams, read only)
```

- **Machines:** each machine logs in over MQTT 3.1.1 or 5 with its own certificate; the CN (`{site}-{line}-{address}`) is its username. The broker ACL lets it write only its own channels and read only its own commands. The line controller may command every machine on the line.
- **Durable streams:** the bridge carries the line's topics one way into NATS, where only the bridge may publish them. JetStream keeps `LINE_EVENTS` (30 days) and `LINE_TELEMETRY` (3 days). The gateway reads through a durable consumer, `<controller>-events`, and may publish only JetStream requests and acks for its own streams and consumer, and delete that one consumer; it cannot delete or purge a stream. A consumer whose subjects no longer match the line (the line changed protocol) is made again at the stream's newest message rather than moved, so a position in another protocol's messages is never carried over. A consumer that can deliver nothing more (its stream or itself gone, the server silent) ends the leader's turn: the gateway stops, the line contends again and ensures its streams anew, so no line leads a wire it cannot read.
- **One site, several codecs:** the streams are ensured with the subjects of every codec the surface runs on the site, sorted, so lines on different roots share `LINE_EVENTS` and `LINE_TELEMETRY` whichever line starts first or last, and two lines starting together on an empty JetStream agree on the stream (the create that loses the race updates instead); a gateway whose consumer the stream would feed nothing, or whose consumer did not follow its line, refuses to start and says which subjects are missing.
- **Where the streams live:** by default in Long Tail's messaging ([events](events.md#messaging)), whose NATS server must run JetStream. The bridge then logs in to that server's edge account for the line (`Machines.edgeAccountFor`), which may publish only the line's subjects, so the edge reaches nothing of Long Tail's. With `MACHINE_SITE_NATS_URL`, the streams live instead in a NATS server of the site's own (`Machines.renderSiteConf`), and Long Tail's NATS stays inside Long Tail. Either way the gateway reads the same streams under the same consumer name.
- **Escalation events:** the gateway inside Long Tail reads them in process. A standalone gateway subscribes to them over Long Tail's messaging.
- **Commands:** the gateway publishes commands to the machine broker at QoS 1, so they queue for a machine that is away.
- **Bot accounts:** in Long Tail each machine is a bot account on its station and receiver roles, so `claimed_by` and `resolved_by` name the machine. The controller bot holds those roles and the operator role, and raises the operator rows. The bots are member accounts with no password, under names the line derives; the line will not start while a person's account holds one of those names.
- **Rows are the authority:** an escalation event only tells the gateway which row to look at. It reads the row back as the controller and acts on the stored role, status and metadata. A row on a role the controller does not hold, or an event its stored row contradicts, does nothing.
- **Roles carry the access:** dispatching to a machine or commanding one means parking a row on that machine's role, so Long Tail's role access decides who can. The gateway acts on a handoff into a machine only on that machine's role, and on a handoff to a person only on a receiver role. A row commands only the machine whose role it is on: cancelling a handoff withdraws the receiver's dispatch, and the sender's job is stopped only by a `cancel` command row on the sender's role.
- **Rendering:** `Machines.renderSiteConf`, `renderMosquittoConf` and `renderMosquittoAcl(lines, codec)` render the configuration from one line or several on the same broker and site NATS: one bridge identity per line, one gateway user allowed every line's streams, and each line's stations and controller in the ACL. The ACL takes its topics from the codec's channels. Lines on different protocols pass a resolver instead of one codec, `renderMosquittoAcl(lines, (line) => codecOf(line))`, and a `root` resolver to `renderSiteConf` and `renderMosquittoConf`, so each line's bridge, subjects and ACL follow its own codec.
- **Machines that host their own broker:** the machine broker connects out to each machine's broker with a Mosquitto bridge, carrying the machine's messages in and its commands out under the machine's level of the line's topics, and its codec reads them there. The bridge's notification topic, kept on the machine broker, is the machine's presence. `examples/workflows/bambu-printer` does this for 3D printers, with a simulated printer (`--profile bambu-sim`) for running it without one.

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
| `MACHINE_LINE_CONFIG` | | The line JSON files, one path or several separated by commas; each site and line once |
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
| `MACHINE_WIRE_TELEMETRY` | `off` | `on` publishes telemetry messages on the wire record too ([Lines view](#lines-view)) |
| `MACHINE_WIRE_WINDOW` | `500` | How many of a line's last wire events its leader keeps for `GET .../wire` |
| `MACHINE_CODEC_MODULE` | | Development server only: a module whose `createCodec(line)` speaks the machines' protocol, for a single line |

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
