# DBA API

Direct database administration endpoints for on-demand pruning and migration deployment. These complement the automated [maintenance schedule](../maintenance.md) — use them for manual cleanup or CI/CD integration. All endpoints require authentication.

## Prune on demand

```
POST /api/dba/prune
```

Runs HotMesh's built-in prune operations against the workflow database. All parameters are optional; defaults are conservative.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `expire` | `string` | `"7 days"` | Retention period — only affect records older than this |
| `jobs` | `boolean` | `true` | Hard-delete expired jobs |
| `streams` | `boolean` | `true` | Hard-delete expired streams |
| `attributes` | `boolean` | `false` | Strip execution artifacts (activity inputs/outputs) from jobs |
| `entities` | `string[]` | — | Entity allowlist — only prune jobs matching these entity names |
| `pruneTransient` | `boolean` | `false` | Delete transient jobs (where entity IS NULL) |
| `keepHmark` | `boolean` | `false` | Preserve the `hmark` field during attribute stripping |

**Example request — delete everything older than 30 days:**

```json
{
  "expire": "30 days",
  "jobs": true,
  "streams": true,
  "pruneTransient": true
}
```

**Example request — prune only review workflows, keep raw data:**

```json
{
  "expire": "14 days",
  "attributes": true,
  "entities": ["reviewContent"],
  "keepHmark": true
}
```

**Response 200:**

```json
{
  "jobs": 42,
  "streams": 156,
  "attributes": 0,
  "transient": 18,
  "marked": 0
}
```

Each field is the count of records affected by that operation.

## Deploy

```
POST /api/dba/deploy
```

Deploys the server-side prune function and runs all pending database migrations. Idempotent — safe to call on every startup or from a CI/CD pipeline.

**Request body:** None.

**Response 200:**

```json
{ "ok": true }
```

This endpoint calls `dbaService.deploy()`, which:
1. Creates or replaces the HotMesh server-side prune function in PostgreSQL.
2. Runs `migrate()` to apply any pending schema files from `services/db/schemas/`.

Both operations are idempotent. Running deploy multiple times has no side effects.
