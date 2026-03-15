# DB Maintenance

HotMesh stores execution artifacts in PostgreSQL: stream messages that carry internal signals between activities, transient job rows that track bookkeeping for individual activity invocations, and entity job rows that represent durable workflow instances. Left unmanaged, these tables grow without bound. The maintenance system provides scheduled, rule-based cleanup that runs as a durable cron workflow inside HotMesh itself.

A default configuration ships with Long Tail. It runs nightly at 2 AM, applies four rules in sequence, and requires no setup. The schedule and rules can be replaced at startup or at runtime through the REST API.

## Configuration via start()

Maintenance is enabled by default when you call `start()`. To customize or disable it:

```typescript
import { start } from '@hotmeshio/long-tail';

// Default: nightly 2 AM cleanup (no config needed)
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
});

// Custom schedule and rules
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  maintenance: {
    schedule: '0 3 * * *',
    rules: [
      { target: 'streams', olderThan: '24 hours', action: 'delete' },
      { target: 'jobs',    olderThan: '14 days',  action: 'delete', hasEntity: false },
      { target: 'jobs',    olderThan: '14 days',  action: 'prune',  hasEntity: true },
      { target: 'jobs',    olderThan: '180 days', action: 'delete', pruned: true },
    ],
  },
});

// Disabled entirely
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  maintenance: false,
});
```

## What gets cleaned

Four categories of data are subject to maintenance:

| Category | Description |
|---|---|
| **Streams** | Redis-style stream messages used internally by HotMesh to coordinate activities. These are pure infrastructure; no user-facing data resides here. |
| **Transient jobs** | Job rows where the `entity` column is `NULL`. These represent activity executions, signal deliveries, and other bookkeeping that is not tied to a named workflow entity. They serve no purpose after execution completes. |
| **Entity jobs** | Job rows where `entity` is set. These represent actual workflow instances -- the rows that back `Durable.Client.workflow.search()` calls and Temporal-compatible exports. Deleting them removes the workflow record entirely. |
| **Pruned jobs** | Entity jobs that have already had their execution artifacts stripped (the `pruned_at` column is not `NULL`). These retain core data but no longer carry execution scaffolding. They can be hard-deleted after a longer retention window. |

## Prune vs. delete

The two actions differ in what they leave behind:

- **Prune** strips execution scaffolding -- activity state, signal payloads, transition metadata -- but preserves the core fields (`jdata`, `udata`, `jmark`, `hmark`). A pruned workflow remains searchable and exportable. Temporal-compatible exports continue to work.
- **Delete** removes the row (or stream message) entirely. The data is gone.

The intended lifecycle for an entity job is: execute, then prune after a short retention period to reclaim space, then delete after a longer period once the record is no longer needed.

## Default schedule

The built-in configuration (`modules/maintenance.ts`) runs at 2 AM daily and applies four rules in order:

```typescript
{
  schedule: '0 2 * * *',
  rules: [
    { target: 'streams', action: 'delete', olderThan: '7 days' },
    { target: 'jobs', action: 'delete', olderThan: '7 days', hasEntity: false },
    { target: 'jobs', action: 'prune',  olderThan: '7 days', hasEntity: true },
    { target: 'jobs', action: 'delete', olderThan: '90 days', pruned: true },
  ],
}
```

| Rule | Effect |
|---|---|
| 1. Delete streams older than 7 days | Removes internal message data that is no longer needed for replay or debugging. |
| 2. Delete transient jobs older than 7 days | Removes activity-level bookkeeping rows that have no associated workflow entity. |
| 3. Prune entity jobs older than 7 days | Strips execution artifacts from workflow instances while preserving core data. Exports and search remain functional. |
| 4. Delete pruned jobs older than 90 days | Hard-deletes workflow instances that were pruned at least 90 days ago. This is the final removal. |

Rules execute sequentially. If one fails, the remaining rules still run; failures are logged and do not halt the cycle.

## Configuration types

### `LTMaintenanceRule`

Defined in `types/maintenance.ts`. Each rule describes a single cleanup operation.

| Field | Type | Required | Description |
|---|---|---|---|
| `target` | `'streams' \| 'jobs'` | Yes | The resource type to act on. |
| `action` | `'delete' \| 'prune'` | Yes | Whether to remove entirely or strip execution artifacts. |
| `olderThan` | `string` | Yes | A PostgreSQL interval expression: `'7 days'`, `'24 hours'`, `'90 days'`. |
| `hasEntity` | `boolean` | No | When `target` is `'jobs'`: `true` selects entity jobs, `false` selects transient jobs (where `entity IS NULL`). |
| `pruned` | `boolean` | No | When `true`, only targets jobs where `pruned_at IS NOT NULL` -- jobs that have already been pruned. |

### `LTMaintenanceConfig`

| Field | Type | Description |
|---|---|---|
| `schedule` | `string` | A cron expression (`'0 2 * * *'`) or an interval string (`'1 day'`). Passed directly to `Virtual.cron` as the `interval` option. |
| `rules` | `LTMaintenanceRule[]` | An ordered array of rules. Executed sequentially on each cron tick. |

## Registry

The `maintenanceRegistry` singleton (`services/maintenance/index.ts`) follows the same pattern as `telemetryRegistry` and `eventRegistry`:

| Method | Purpose |
|---|---|
| `register(config)` | Store a maintenance configuration. Replaces any previously registered config. Call before `connect()`. |
| `connect()` | Start the `Virtual.cron` workflow that fires on the configured schedule. Idempotent -- given the same internal cron ID, duplicate calls do not create duplicate schedules. |
| `disconnect()` | Cancel the running cron by calling `Virtual.interrupt`. Safe to call if no cron is running. |
| `clear()` | Remove the config and reset internal state. Used in tests. |
| `hasConfig` | Boolean property. `true` when a config has been registered. |
| `config` | Returns the current `LTMaintenanceConfig` or `null`. |

## Programmatic registration

For advanced use cases, you can register maintenance programmatically instead of through `start()`. The `start()` function handles this automatically when a `maintenance` config is provided (or uses the default when omitted):

```typescript
import { maintenanceRegistry, defaultMaintenanceConfig } from '@hotmeshio/long-tail';

maintenanceRegistry.register(defaultMaintenanceConfig);
```

To use a custom config instead, register it in place of the default:

```typescript
import { maintenanceRegistry } from '@hotmeshio/long-tail';

maintenanceRegistry.register({
  schedule: '0 3 * * 0',  // Sundays at 3 AM
  rules: [
    { target: 'streams', action: 'delete', olderThan: '14 days' },
    { target: 'jobs', action: 'delete', olderThan: '14 days', hasEntity: false },
    { target: 'jobs', action: 'prune', olderThan: '30 days', hasEntity: true },
    { target: 'jobs', action: 'delete', olderThan: '180 days', pruned: true },
  ],
});
```

The registry accepts exactly one config at a time. Calling `register()` again overwrites the previous config. The cron does not start until `connect()` is called — which happens inside `start()` when `hasConfig` is `true`.

## Runtime API

The REST API allows administrators to replace the maintenance config while the server is running.

### `GET /api/config/maintenance`

Returns the current configuration and whether a cron is active.

```json
{
  "config": {
    "schedule": "0 2 * * *",
    "rules": [ ... ]
  },
  "active": true
}
```

### `PUT /api/config/maintenance`

Admin-only (requires `requireAdmin` middleware). Accepts a full replacement config in the request body:

```json
{
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

1. **Disconnect** -- calls `maintenanceRegistry.disconnect()` to cancel the running cron via `Virtual.interrupt`.
2. **Register** -- calls `maintenanceRegistry.register()` with the new config.
3. **Connect** -- calls `maintenanceRegistry.connect()` to start a new cron with the updated schedule and rules.

Returns the new config and `{ "restarted": true }` on success. Returns `400` if `schedule` or `rules` is missing, and `500` if any step fails.

## Custom schedule example

A production deployment that processes high volumes might want aggressive short-term cleanup with a longer archive window:

```typescript
import { maintenanceRegistry } from '@hotmeshio/long-tail';

maintenanceRegistry.register({
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
2. **Connection.** `maintenanceRegistry.connect()` calls `Virtual.cron()` with a fixed topic (`lt.maintenance.prune`) and a fixed cron ID (`lt-maintenance-nightly`). HotMesh persists the cron schedule in PostgreSQL, making it durable across restarts. If a cron with that ID already exists, it is replaced.
3. **Execution.** On each tick of the schedule, the cron callback iterates the rules array. For each rule, it translates the rule's fields into the appropriate `dbaService.prune()` parameters and executes the call. Rules run sequentially; a failure in one rule is logged and does not prevent subsequent rules from running.
4. **Disconnection.** `maintenanceRegistry.disconnect()` calls `Virtual.interrupt()` with the same topic and cron ID, which cancels the recurring schedule. This is called during graceful shutdown and before reconfiguration via the REST API.

Because the cron is itself a durable workflow, the schedule survives process restarts. If the server goes down at 2 AM and comes back at 2:05 AM, the missed tick executes on reconnection.
