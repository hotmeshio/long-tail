# lt.tasks

Create and query workflow tasks and processes tracked by the Long Tail interceptor.

## create

Create a new task record.

```typescript
const result = await lt.tasks.create({
  workflow_id: 'order-pipeline-abc123',
  workflow_type: 'orderPipeline',
  lt_type: 'workflow',
  signal_id: 'sig-abc123',
  parent_workflow_id: 'order-pipeline-abc123',
  envelope: '{"data":{"orderId":"order-456"}}',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workflow_id` | `string` | Yes | HotMesh workflow ID |
| `workflow_type` | `string` | Yes | Registered workflow name |
| `lt_type` | `string` | Yes | Interceptor classification |
| `signal_id` | `string` | Yes | HotMesh signal ID for resume/replay |
| `parent_workflow_id` | `string` | Yes | Orchestrator workflow ID |
| `task_queue` | `string` | No | Task queue the workflow runs on |
| `origin_id` | `string` | No | Correlation ID shared by sibling workflows |
| `parent_id` | `string` | No | Direct parent workflow ID |
| `envelope` | `string` | No | JSON-serialized input envelope (default: `{}`) |
| `metadata` | `object` | No | Arbitrary metadata |
| `priority` | `number` | No | Numeric priority (default: 2) |
| `trace_id` | `string` | No | Trace ID for distributed tracing |
| `span_id` | `string` | No | Span ID for distributed tracing |

**Returns:** `LTApiResult<Task>` with status 201.

**Auth:** Required (authenticated user is recorded as `initiated_by`)

---

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
