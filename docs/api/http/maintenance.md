# Maintenance API

The maintenance API configures automated database cleanup. Long Tail ships a default schedule that runs nightly at 2 AM. These endpoints let you inspect and replace the configuration at runtime. The PUT endpoint requires admin access.

For background on what maintenance does and how rules work, see [Maintenance](../maintenance.md).

## Get current configuration

```
GET /api/config/maintenance
```

**Response 200:**

```json
{
  "config": {
    "schedule": "0 2 * * *",
    "rules": [
      { "target": "streams", "olderThan": "7 days", "action": "delete" },
      { "target": "jobs", "olderThan": "7 days", "action": "delete", "hasEntity": false },
      { "target": "jobs", "olderThan": "7 days", "action": "prune", "hasEntity": true },
      { "target": "jobs", "olderThan": "90 days", "action": "delete", "pruned": true }
    ]
  },
  "active": true
}
```

The `active` field indicates whether the maintenance cron is currently running.

## Update configuration

```
PUT /api/config/maintenance
```

Replaces the maintenance configuration and restarts the cron. The endpoint disconnects the current cron (if running), registers the new config, and starts a new cron. This is atomic from the caller's perspective.

**Requires:** Admin access (`requireAdmin` middleware).

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule` | `string` | yes | Cron expression (`0 3 * * *`) or interval (`1 day`) |
| `rules` | `array` | yes | Ordered list of maintenance rules |

Each rule:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | `string` | yes | `streams` or `jobs` |
| `action` | `string` | yes | `delete` or `prune` |
| `olderThan` | `string` | yes | PostgreSQL interval (e.g., `7 days`, `24 hours`, `90 days`) |
| `hasEntity` | `boolean` | no | `true` for entity jobs, `false` for transient jobs |
| `pruned` | `boolean` | no | `true` to target only already-pruned jobs |

**Example request:**

```json
{
  "schedule": "0 3 * * *",
  "rules": [
    { "target": "streams", "olderThan": "24 hours", "action": "delete" },
    { "target": "jobs", "olderThan": "14 days", "action": "delete", "hasEntity": false },
    { "target": "jobs", "olderThan": "14 days", "action": "prune", "hasEntity": true },
    { "target": "jobs", "olderThan": "180 days", "action": "delete", "pruned": true }
  ]
}
```

**Response 200:**

```json
{
  "config": {
    "schedule": "0 3 * * *",
    "rules": [ ... ]
  },
  "restarted": true
}
```

The `restarted` field confirms the cron was restarted with the new configuration.

### What happens on PUT

1. The current cron is cancelled (`maintenanceRegistry.disconnect()`).
2. The new config is stored (`maintenanceRegistry.register(config)`).
3. A new cron is started (`maintenanceRegistry.connect()`).

If the cron was not previously running, steps 1 is a no-op. The net effect is that the old schedule is replaced and the new one takes effect immediately.
