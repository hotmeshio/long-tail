# lt.mcpRuns

Query MCP workflow execution history: entities, jobs, and full execution timelines.

## listEntities

List distinct entity types for an app (HotMesh namespace).

```typescript
const result = await lt.mcpRuns.listEntities({ app_id: 'durable' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `app_id` | `string` | Yes | HotMesh app ID (e.g. `"durable"`) |

**Returns:** `LTApiResult<{ entities: string[] }>`

**Auth:** Not required

---

## listJobs

List jobs (workflow executions) for an app, with optional filters.

```typescript
const result = await lt.mcpRuns.listJobs({
  app_id: 'durable',
  entity: 'mcp_query',
  limit: 25,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `app_id` | `string` | Yes | HotMesh app ID |
| `limit` | `number` | No | Max results to return |
| `offset` | `number` | No | Pagination offset |
| `entity` | `string` | No | Filter by entity type |
| `search` | `string` | No | Full-text search |
| `status` | `string` | No | Filter by job status |

**Returns:** `LTApiResult<{ jobs: any[], total: number }>`

**Auth:** Not required

---

## getExecution

Get the full execution history for a single job.

```typescript
const result = await lt.mcpRuns.getExecution({ jobId: 'job-123', app_id: 'durable' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobId` | `string` | Yes | HotMesh job (workflow) ID |
| `app_id` | `string` | Yes | HotMesh app ID |

**Returns:** `LTApiResult<ExecutionTimeline>`

**Auth:** Not required
