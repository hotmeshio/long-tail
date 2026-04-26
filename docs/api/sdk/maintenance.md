# lt.maintenance

Configure and manage the automated maintenance cron for data pruning.

## getConfig

Return the current maintenance cron configuration and whether it is active.

```typescript
const result = lt.maintenance.getConfig();
```

**Parameters:** None

**Returns:** `LTApiResult<{ config: LTMaintenanceConfig | null, active: boolean }>`

**Auth:** Not required

---

## updateConfig

Replace the maintenance configuration and restart the cron. The schedule begins executing immediately.

```typescript
const result = await lt.maintenance.updateConfig({
  schedule: '0 3 * * *',
  rules: [
    { target: 'streams', action: 'delete', olderThan: '7 days' },
    { target: 'jobs', action: 'prune', olderThan: '90 days', hasEntity: true },
  ],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule` | `string` | Yes | Cron expression (e.g. `'0 3 * * *'`) |
| `rules` | `LTMaintenanceRule[]` | Yes | Ordered list of maintenance rules |

Each `LTMaintenanceRule` has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `target` | `'streams' \| 'jobs'` | Yes | Which resource to target |
| `action` | `'delete' \| 'prune'` | Yes | `delete` = hard-delete rows; `prune` = strip execution artifacts |
| `olderThan` | `string` | Yes | Retention window, e.g. `'7 days'`, `'90 days'` |
| `hasEntity` | `boolean` | No | When target is `jobs`: true = entity jobs, false = transient |
| `pruned` | `boolean` | No | When true, only target jobs already pruned |

**Returns:** `LTApiResult<{ config: LTMaintenanceConfig, restarted: true }>`

**Auth:** Not required
