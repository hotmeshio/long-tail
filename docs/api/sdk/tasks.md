# lt.tasks

Query workflow tasks and processes tracked by the Long Tail interceptor.

## list

List tasks with optional filters.

```typescript
const result = await lt.tasks.list({
  status: 'pending',
  workflow_type: 'reviewContent',
  limit: 25,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `string` | No | Filter by `pending` or `completed` |
| `lt_type` | `string` | No | Filter by interceptor classification |
| `workflow_type` | `string` | No | Filter by workflow function name |
| `workflow_id` | `string` | No | Filter by HotMesh workflow ID |
| `parent_workflow_id` | `string` | No | Filter by parent orchestrator ID |
| `origin_id` | `string` | No | Filter by root process origin ID |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset (default: 0) |

**Returns:** `LTApiResult<{ tasks, total }>`

**Auth:** Not required

---

## get

Get a single task by ID.

```typescript
const result = await lt.tasks.get({ id: 'task_abc123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Task UUID |

**Returns:** `LTApiResult<Task>` -- returns status 404 if not found.

**Auth:** Not required

---

## listProcesses

List processes (grouped by origin_id) with optional filters.

```typescript
const result = await lt.tasks.listProcesses({
  workflow_type: 'reviewContent',
  status: 'pending',
  limit: 20,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |
| `workflow_type` | `string` | No | Filter by workflow type |
| `status` | `string` | No | Filter by status |
| `search` | `string` | No | Full-text search across process fields |

**Returns:** `LTApiResult<{ processes, total }>`

**Auth:** Not required

---

## getProcess

Get a single process with all its tasks and escalations.

```typescript
const result = await lt.tasks.getProcess({ originId: 'origin_xyz' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `originId` | `string` | Yes | Root process origin ID |

**Returns:** `LTApiResult<{ origin_id, tasks, escalations }>`

**Auth:** Not required

---

## getProcessStats

Return aggregate process statistics.

```typescript
const result = await lt.tasks.getProcessStats({ period: '24h' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `period` | `string` | No | Time window (`1h`, `24h`, `7d`, `30d`) |

**Returns:** `LTApiResult<ProcessStats>`

**Auth:** Not required
