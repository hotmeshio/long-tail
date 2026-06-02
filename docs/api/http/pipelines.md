# Pipelines API

Query and manage pipeline execution runs. Runs are stored in HotMesh's `{namespace}.jobs` table, one schema per namespace. All endpoints require authentication.

## List runs

```
GET /api/pipelines
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `app_id` | `string` | **Required.** Namespace to query (e.g., `longtail`, `lt-yaml`) |
| `entity` | `string` | Filter by tool/entity name (e.g., `rotate_and_verify`) |
| `search` | `string` | Search by workflow ID substring (case-insensitive) |
| `status` | `string` | Filter by status: `running`, `completed`, `failed` |
| `limit` | `integer` | Max results (default: 20, max: 100) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:**

```json
{
  "jobs": [
    {
      "workflow_id": "abc123...",
      "entity": "rotate_and_verify",
      "status": "completed",
      "is_live": false,
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:05Z"
    }
  ],
  "total": 1
}
```

**Response 400:** Missing `app_id`.

## List entities (tools)

```
GET /api/pipelines/entities
```

Returns distinct entity names from job runs, supplemented with `graph_topic` values from active/deployed YAML workflows for the namespace.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `app_id` | `string` | **Required.** Namespace to query |

**Response 200:**

```json
{
  "entities": ["extract_info", "rotate_and_verify"]
}
```

Entities are sorted alphabetically and exclude null/empty values.

**Response 400:** Missing `app_id`.

## Get execution detail

```
GET /api/pipelines/:jobId/execution
```

Returns full execution detail for a specific run, including inflated activity events, trace IDs, and a summary.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `app_id` | `string` | **Required.** Namespace to query |

**Response 200:**

```json
{
  "workflow_id": "abc123...",
  "workflow_type": "rotate_and_verify",
  "workflow_name": "rotate_and_verify",
  "task_queue": "lt-yaml",
  "status": "completed",
  "start_time": "2025-01-15T10:00:00.000Z",
  "close_time": "2025-01-15T10:00:05.230Z",
  "duration_ms": 5230,
  "trace_id": "a5fb792464c1d6c7e692824f0ceb011d",
  "result": { "rotated_url": "https://...", "verified": true },
  "events": [...],
  "summary": {
    "total_events": 5,
    "activities": { "total": 2, "completed": 2, "failed": 0, "system": 1, "user": 1 },
    "child_workflows": { "total": 0, "completed": 0, "failed": 0 },
    "timers": 0,
    "signals": 0
  }
}
```

**Response 400:** Missing `app_id`.

**Response 404:** Job not found.

## Interrupt a running pipeline

```
POST /api/pipelines/:jobId/interrupt
```

Immediately terminates a running pipeline job via `HotMesh.interrupt()`. The job is marked as interrupted and its state is expired.

**Body:**

```json
{
  "topic": "rotate_and_verify",
  "app_id": "longtail"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `topic` | `string` | **Required.** Workflow entity/topic name |
| `app_id` | `string` | **Required.** HotMesh namespace |

**Response 200:**

```json
{
  "interrupted": true,
  "jobId": "abc123..."
}
```

**Response 400:** Missing `topic` or `app_id`.
