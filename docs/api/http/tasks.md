# Tasks API

Tasks represent workflow executions tracked by the LT interceptor. A task record is created when a workflow starts and updated when it completes. All endpoints require authentication.

## Create task

```
POST /api/tasks
```

**Request body:**

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
| `priority` | `integer` | No | Numeric priority (default: 2) |
| `trace_id` | `string` | No | Trace ID for distributed tracing |
| `span_id` | `string` | No | Span ID for distributed tracing |

**Example request:**

```json
{
  "workflow_id": "order-pipeline-abc123",
  "workflow_type": "orderPipeline",
  "lt_type": "workflow",
  "signal_id": "sig-abc123",
  "parent_workflow_id": "order-pipeline-abc123",
  "envelope": "{\"data\":{\"orderId\":\"order-456\"}}"
}
```

**Response 201:** The created task record.

**Response 400:**

```json
{ "error": "workflow_id is required" }
```

---

## List tasks

```
GET /api/tasks
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | Filter by status: `pending` or `completed` |
| `workflow_type` | `string` | Filter by workflow type (e.g., `reviewContent`) |
| `workflow_id` | `string` | Filter by HotMesh workflow ID |
| `lt_type` | `string` | Filter by interceptor classification |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Example request:**

```
GET /api/tasks?status=completed&workflow_type=reviewContent&limit=10
```

**Response 200:**

```json
{
  "tasks": [
    {
      "id": "d4e5f6a7-...",
      "workflow_id": "review-orch-post-456-a1b2c3d4",
      "workflow_type": "reviewContent",
      "lt_type": "workflow",
      "task_queue": "long-tail",
      "modality": "default",
      "status": "completed",
      "priority": 2,
      "signal_id": "sig-abc123",
      "parent_workflow_id": "review-orch-post-456-a1b2c3d4",
      "origin_id": "review-orch-post-456-a1b2c3d4",
      "parent_id": null,
      "started_at": "2025-01-15T10:00:00.000Z",
      "completed_at": "2025-01-15T10:00:05.230Z",
      "envelope": "{\"data\":{\"contentId\":\"post-456\",\"content\":\"...\"},\"metadata\":{}}",
      "metadata": null,
      "error": null,
      "milestones": [
        { "name": "ai_review", "value": "approved" }
      ],
      "data": "{\"approved\":true,\"analysis\":{\"confidence\":0.92}}",
      "created_at": "2025-01-15T10:00:00.000Z",
      "updated_at": "2025-01-15T10:00:05.230Z"
    }
  ],
  "total": 1
}
```

## Get task details

```
GET /api/tasks/:id
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Task UUID |

**Response 200:** A single task object (same shape as the array element above).

**Response 404:**

```json
{ "error": "Task not found" }
```

## Get process stats

```
GET /api/tasks/processes/stats
```

Aggregated process statistics with optional time period.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | `string` | Time period filter (e.g., `24h`, `7d`) |

**Response 200:** Aggregated statistics object.

## List processes

```
GET /api/tasks/processes
```

List distinct `origin_id` values with summary stats. Each origin ID represents a process (a top-level orchestration and all its child workflows).

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `workflow_type` | `string` | Filter by workflow type |
| `status` | `string` | Filter by status |
| `search` | `string` | Search filter |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:** Process list with summary stats.

## Get process details

```
GET /api/tasks/processes/:originId
```

Returns all tasks and escalations for a process (identified by `origin_id`).

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `originId` | Origin ID (correlation ID shared by sibling workflows) |

**Response 200:**

```json
{
  "origin_id": "review-orch-post-456-a1b2c3d4",
  "tasks": [],
  "escalations": []
}
```

## Task fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `UUID` | Primary key |
| `workflow_id` | `string` | HotMesh workflow ID |
| `workflow_type` | `string` | Registered workflow name |
| `lt_type` | `string` | Interceptor classification |
| `task_queue` | `string` | Task queue the workflow ran on |
| `modality` | `string` | Modality from workflow config |
| `status` | `string` | `pending` or `completed` |
| `priority` | `integer` | Numeric priority (lower = higher) |
| `signal_id` | `string` | HotMesh signal ID for resume/replay |
| `parent_workflow_id` | `string` | Orchestrator workflow ID |
| `origin_id` | `string` | Correlation ID shared by sibling workflows |
| `parent_id` | `string` | Direct parent workflow ID |
| `started_at` | `ISO 8601` | When the workflow began |
| `completed_at` | `ISO 8601` | When it finished (null while pending) |
| `envelope` | `string` | JSON-serialized input envelope |
| `metadata` | `object` | Arbitrary metadata |
| `error` | `string` | Error message on failure |
| `milestones` | `array` | Milestone objects emitted during execution |
| `data` | `string` | JSON-serialized workflow return data |

See [Data Model](../data.md) for the full SQL schema.
