# DB Maintenance

HotMesh stores execution artifacts in PostgreSQL: stream messages that carry internal signals between activities, transient job rows that track bookkeeping for individual activity invocations, and entity job rows that represent durable workflow instances. Left unmanaged, these tables grow without bound. The maintenance system provides scheduled, rule-based cleanup that runs as a durable cron workflow inside HotMesh itself.

Maintenance is opt-in. A default configuration ships with Long Tail: pass `maintenance: true` to `start()` and it runs weekly, Sundays at 2 AM, applying five rules in sequence. A config object of your own replaces it, and the rules can be replaced at runtime through the REST API.

## Configuration via start()

`start()` registers maintenance only when its `maintenance` option asks for it:

| `maintenance` | Effect |
|---|---|
| omitted or `false` | No maintenance runs. |
| `true` | The default configuration (see [Default schedule](#default-schedule)). |
| an `LTMaintenanceConfig` | That configuration, in place of the default. |

```typescript
import { start } from '@hotmeshio/long-tail';

// Default: Sundays at 2 AM
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  maintenance: true,
});

// Custom schedule and rules
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  maintenance: {
    appId: 'durable',
    schedule: '0 3 * * *',
    rules: [
      { target: 'streams', olderThan: '24 hours', action: 'delete' },
      { target: 'jobs',    olderThan: '14 days',  action: 'delete', hasEntity: false },
      { target: 'jobs',    olderThan: '14 days',  action: 'prune',  hasEntity: true },
      { target: 'jobs',    olderThan: '180 days', action: 'delete', pruned: true },
      { target: 'escalations', olderThan: '180 days', action: 'delete' },
      { target: 'oauth',       olderThan: '7 days',   action: 'delete' },
    ],
  },
});

// No maintenance: omit the option (or pass false)
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
});
```

Maintenance starts once workers start, and not on a readonly instance.

## What gets cleaned

Six categories of data are subject to maintenance:

| Category | Description |
|---|---|
| **Streams** | Stream messages used internally by HotMesh to coordinate activities. These are pure infrastructure; no user-facing data resides here. |
| **Transient jobs** | Job rows where the `entity` column is `NULL`. These represent activity executions, signal deliveries, and other bookkeeping that is not tied to a named workflow entity. They serve no purpose after execution completes. |
| **Entity jobs** | Job rows where `entity` is set. These represent actual workflow instances -- the rows that back `Durable.Client.workflow.search()` calls and execution exports. Deleting them removes the workflow record entirely. |
| **Pruned jobs** | Entity jobs that have already had their execution artifacts stripped (the `pruned_at` column is not `NULL`). These retain core data but no longer carry execution scaffolding. They can be hard-deleted after a longer retention window. |
| **Terminal escalations** | Escalation rows in a terminal status (`resolved`, `cancelled`, `expired`). Terminal rows are inert audit records -- every engine state transition guards on `status = 'pending'`, so aging them out is safe for live waiters, claims, and signal delivery. The engine-owned prune deletes in atomic batches until the retention horizon is drained. Pending rows are never touched. |
| **OAuth server rows** | The `/mcp` authorization server's records. Refresh tokens and authorization codes past expiry, or rotated out, longer ago than the window; then grants left with neither, or revoked longer ago than the window; then clients registered longer ago than the window with no live grant. A client still holding a live refresh token keeps its grant and its registration. |

## Prune vs. delete

The two actions differ in what they leave behind:

- **Prune** strips execution scaffolding -- activity state, signal payloads, transition metadata -- but preserves the core fields (`jdata`, `udata`, `jmark`, `hmark`). A pruned workflow remains searchable and exportable. Execution exports continue to work.
- **Delete** removes the row (or stream message) entirely. The data is gone.

The intended lifecycle for an entity job is: execute, then prune after a short retention period to reclaim space, then delete after a longer period once the record is no longer needed.

## Default schedule

The default configuration (`modules/maintenance.ts`, enabled with `maintenance: true`) runs Sundays at 2 AM and applies five rules in order:

```typescript
{
  appId: 'durable',
  schedule: '0 2 * * 0',
  rules: [
    { target: 'streams', action: 'delete', olderThan: '30 days' },
    { target: 'jobs', action: 'delete', olderThan: '30 days', hasEntity: false },
    { target: 'jobs', action: 'prune',  olderThan: '30 days', hasEntity: true },
    { target: 'jobs', action: 'delete', olderThan: '180 days', pruned: true },
    { target: 'oauth', action: 'delete', olderThan: '7 days' },
  ],
}
```

| Rule | Effect |
|---|---|
| 1. Delete streams older than 30 days | Removes internal message data that is no longer needed for replay or debugging. |
| 2. Delete transient jobs older than 30 days | Removes activity-level bookkeeping rows that have no associated workflow entity. |
| 3. Prune entity jobs older than 30 days | Strips execution artifacts from workflow instances while preserving core data. Exports and search remain functional. |
| 4. Delete pruned jobs older than 180 days | Hard-deletes workflow instances that were pruned at least 180 days ago. This is the final removal. |
| 5. Delete OAuth server rows older than 7 days | Removes expired codes and tokens, unused or revoked grants, and clients with no live grant. |

A custom `rules` list replaces the defaults, so include the `oauth` rule when the OAuth server is enabled.

Rules execute sequentially. If one fails, the remaining rules still run; failures are logged and do not halt the cycle.

## Configuration types

### `LTMaintenanceRule`

Defined in `types/maintenance.ts`. Each rule describes a single cleanup operation.

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `'streams' \| 'jobs' \| 'escalations' \| 'oauth'` | Yes | The resource type to act on. |
| `action` | `'delete' \| 'prune'` | Yes | Whether to remove entirely or strip execution artifacts. |
| `olderThan` | `string` | Yes | A PostgreSQL interval expression: `'7 days'`, `'24 hours'`, `'90 days'`. |
| `hasEntity` | `boolean` | No | When `target` is `'jobs'`: `true` selects entity jobs, `false` selects transient jobs (where `entity IS NULL`). |
| `pruned` | `boolean` | No | When `true`, only targets jobs where `pruned_at IS NOT NULL` -- jobs that have already been pruned. |
| `statuses` | `Array<'resolved' \| 'cancelled' \| 'expired'>` | No | When `target` is `'escalations'`: which terminal statuses to age out. Defaults to all three. |

### `LTMaintenanceConfig`

| Field | Type | Description |
|---|---|---|
| `appId` | `string` | The HotMesh application namespace to prune. The default configuration uses `'durable'`. |
| `schedule` | `string` | A cron expression (`'0 2 * * *'`) or an interval string (`'1 day'`). Passed directly to `Virtual.cron` as the `interval` option. |
| `rules` | `LTMaintenanceRule[]` | An ordered array of rules. Executed sequentially on each cron tick. |

## Registry

The `maintenanceRegistry` singleton (`services/maintenance/index.ts`) follows the same pattern as `telemetryRegistry` and `eventRegistry`:

| Method | Purpose |
|---|---|
| `register(config)` | Store a maintenance configuration. Replaces any previously registered config. Call before `connect()`. |
| `connect()` | Start the `Virtual.cron` workflow that fires on the configured schedule. Idempotent -- given the same internal cron ID, duplicate calls do not create duplicate schedules. |
| `disconnect()` | Mark this registry disconnected, on graceful shutdown or before a reconfiguration. The durable cron job is left in place: it is shared by every container, and another container (or this one after a restart) keeps servicing it. |
| `clear()` | Remove the config and reset internal state. Used in tests. |
| `hasConfig` | Boolean property. `true` when a config has been registered. |
| `config` | Returns the current `LTMaintenanceConfig` or `null`. |

## Programmatic registration

For advanced use cases, you can register maintenance programmatically instead of through `start()`. `start()` does this itself when `maintenance` is `true` (the default configuration) or a config object:

```typescript
import { maintenanceRegistry, defaultMaintenanceConfig } from '@hotmeshio/long-tail';

maintenanceRegistry.register(defaultMaintenanceConfig);
```

To use a custom config instead, register it in place of the default:

```typescript
import { maintenanceRegistry } from '@hotmeshio/long-tail';

maintenanceRegistry.register({
  appId: 'durable',
  schedule: '0 3 * * 0',  // Sundays at 3 AM
  rules: [
    { target: 'streams', action: 'delete', olderThan: '14 days' },
    { target: 'jobs', action: 'delete', olderThan: '14 days', hasEntity: false },
    { target: 'jobs', action: 'prune', olderThan: '30 days', hasEntity: true },
    { target: 'jobs', action: 'delete', olderThan: '180 days', pruned: true },
  ],
});
```

The registry accepts exactly one config at a time. Calling `register()` again overwrites the previous config. The cron does not start until `connect()` is called, which `start()` does when `hasConfig` is `true`.

## Runtime API

The REST API allows administrators to replace the maintenance config while the server is running.

### `GET /api/config/maintenance`

Returns the current configuration. `active` is `true` when a configuration is registered; `config` is `null` and `active` is `false` when none is.

```json
{
  "config": {
    "appId": "durable",
    "schedule": "0 2 * * 0",
    "rules": [ ... ]
  },
  "active": true
}
```

### `PUT /api/config/maintenance`

Admin-only (requires `requireAdmin` middleware). Accepts a full replacement config in the request body:

```json
{
  "appId": "durable",
  "schedule": "0 4 * * *",
  "rules": [
    { "target": "streams", "action": "delete", "olderThan": "3 days" },
    { "target": "jobs", "action": "delete", "olderThan": "3 days", "hasEntity": false },
    { "target": "jobs", "action": "prune", "olderThan": "3 days", "hasEntity": true },
    { "target": "jobs", "action": "delete", "olderThan": "60 days", "pruned": true }
  ]
}
```

The endpoint performs three operations in sequence:

1. **Disconnect** -- calls `maintenanceRegistry.disconnect()`.
2. **Register** -- calls `maintenanceRegistry.register()` with the new config.
3. **Connect** -- calls `maintenanceRegistry.connect()`, which registers this container's cron worker with the new rules.

The new rules apply to the ticks this container runs. The configuration is held in memory: other containers keep the rules they started with, and a restart returns this one to its `start()` configuration. The schedule is fixed when the cron job is first created: an existing job keeps its schedule (see [How it works internally](#how-it-works-internally)).

Returns the new config and `{ "restarted": true }` on success. Returns `400` if `appId`, `schedule` or `rules` is missing, and `500` if any step fails.

## Custom schedule example

A production deployment that processes high volumes might want aggressive short-term cleanup with a longer archive window:

```typescript
import { maintenanceRegistry } from '@hotmeshio/long-tail';

maintenanceRegistry.register({
  appId: 'durable',
  schedule: '0 */6 * * *',  // every 6 hours
  rules: [
    { target: 'streams', action: 'delete', olderThan: '24 hours' },
    { target: 'jobs', action: 'delete', olderThan: '48 hours', hasEntity: false },
    { target: 'jobs', action: 'prune', olderThan: '3 days', hasEntity: true },
    { target: 'jobs', action: 'delete', olderThan: '365 days', pruned: true },
  ],
});
```

This cleans streams and transient jobs within two days, prunes entity jobs after three days (preserving export capability), and retains pruned records for a full year before final deletion.

## How it works internally

The maintenance system runs on top of HotMesh's `Virtual.cron`, the same primitive that powers durable recurring workflows throughout the platform.

1. **Registration.** `maintenanceRegistry.register(config)` stores the config in memory. No I/O occurs.
2. **Connection.** `maintenanceRegistry.connect()` calls `Virtual.cron()` with a fixed topic (`lt.maintenance.prune`) and a fixed cron ID (`lt-maintenance-nightly`). This registers the container's worker for the topic and starts the cron job. HotMesh persists the job in PostgreSQL, making it durable across restarts. If a job with that ID already exists, it keeps running on the schedule it was created with, and no second job starts.
3. **Execution.** On each tick of the schedule, the worker that takes the tick runs its rules in order. Stream and job rules call `dbaService.prune()`; escalation rules call the escalation client's batched prune until the window is drained; the `oauth` rule calls the OAuth server prune. A failure in one rule is logged and does not prevent subsequent rules from running.
4. **Disconnection.** `maintenanceRegistry.disconnect()` marks the registry disconnected, during graceful shutdown and before reconfiguration via the REST API. It does not interrupt the cron job, which other containers keep servicing.

Because the cron is itself a durable workflow, the schedule survives process restarts. If the server goes down at 2 AM and comes back at 2:05 AM, the missed tick executes on reconnection.
