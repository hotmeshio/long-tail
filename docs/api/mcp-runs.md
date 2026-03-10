# MCP Runs API (Process Server Runs)

Query execution runs from MCP process servers. Runs are stored in HotMesh's `{namespace}.jobs` table, one schema per namespace. All endpoints require authentication.

## List runs

```
GET /api/mcp-runs
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
GET /api/mcp-runs/entities
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
GET /api/mcp-runs/:jobId/execution
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
  "events": [
    {
      "event_id": 1,
      "event_type": "workflow_execution_started",
      "category": "workflow",
      "event_time": "2025-01-15T10:00:00.000Z",
      "duration_ms": null,
      "is_system": false,
      "attributes": { "kind": "workflow_execution_started", "workflow_type": "rotate_and_verify" }
    },
    {
      "event_id": 2,
      "event_type": "activity_task_scheduled",
      "category": "activity",
      "event_time": "2025-01-15T10:00:00.100Z",
      "duration_ms": null,
      "is_system": false,
      "attributes": { "kind": "activity_task_scheduled", "activity_type": "rotate_image" }
    }
  ],
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
