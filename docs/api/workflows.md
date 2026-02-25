# Workflows API

All endpoints require authentication. Responses use `application/json`.

## Configuration

### List all workflow configurations

```
GET /api/workflows/config
```

**Response 200:**

```json
{
  "workflows": [
    {
      "id": "a1b2c3d4-...",
      "workflow_type": "reviewContent",
      "is_lt": true,
      "is_container": false,
      "task_queue": "long-tail",
      "default_role": "reviewer",
      "default_modality": "default",
      "description": null,
      "consumes": [],
      "roles": [
        { "id": "...", "workflow_type": "reviewContent", "role": "reviewer" }
      ],
      "lifecycle": {
        "onBefore": [],
        "onAfter": []
      },
      "created_at": "2025-01-15T10:00:00.000Z",
      "updated_at": "2025-01-15T10:00:00.000Z"
    }
  ]
}
```

### Get a single workflow configuration

```
GET /api/workflows/:type/config
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `type` | Workflow type name (e.g., `reviewContent`) |

**Response 200:** A single workflow config object (same shape as the array element above).

**Response 404:**

```json
{ "error": "Workflow config not found" }
```

### Create or replace a workflow configuration

```
PUT /api/workflows/:type/config
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `type` | Workflow type name |

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `is_lt` | `boolean` | `true` | Enable the LT interceptor for this workflow |
| `is_container` | `boolean` | `false` | `true` for orchestrators that coordinate child workflows |
| `task_queue` | `string \| null` | `null` | Default task queue name |
| `default_role` | `string` | `"reviewer"` | Role assigned to escalations when the workflow doesn't specify one |
| `default_modality` | `string` | `"portal"` | Default modality |
| `description` | `string \| null` | `null` | Human-readable description |
| `roles` | `string[]` | `[]` | Roles allowed to claim escalations for this workflow |
| `lifecycle` | `object` | `{ onBefore: [], onAfter: [] }` | Hook definitions (see below) |
| `consumes` | `string[]` | `[]` | Workflow types whose completed data this workflow receives via `envelope.lt.providers` |

**Lifecycle hooks:**

```json
{
  "lifecycle": {
    "onBefore": [
      { "target_workflow_type": "precheck", "target_task_queue": "long-tail", "ordinal": 0 }
    ],
    "onAfter": [
      { "target_workflow_type": "notify", "ordinal": 0 }
    ]
  }
}
```

Each hook has:
- `target_workflow_type` (required) — the workflow to invoke
- `target_task_queue` (optional) — queue for the target workflow
- `ordinal` (optional, default `0`) — execution order (lower runs first)

**Example request:**

```json
{
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer", "senior-reviewer"],
  "consumes": ["extractDocument"]
}
```

**Response 200:** The created or updated config object.

This endpoint is idempotent. It replaces the entire configuration, including roles and lifecycle hooks (cascade delete + re-insert). It also invalidates the in-memory config cache.

### Delete a workflow configuration

```
DELETE /api/workflows/:type/config
```

Deletes the workflow config and all associated roles and lifecycle hooks (cascade).

**Response 200:**

```json
{ "deleted": true, "workflow_type": "reviewContent" }
```

**Response 404:**

```json
{ "error": "Workflow config not found" }
```

---

## Execution

### Start a content review workflow

```
POST /api/workflows/review-content
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contentId` | `string` | yes | Identifier for the content being reviewed |
| `content` | `string` | yes | The content to review |
| `contentType` | `string` | no | Content classification (e.g., `article`, `comment`) |

**Example request:**

```json
{
  "contentId": "post-456",
  "content": "This article discusses the impact of...",
  "contentType": "article"
}
```

**Response 202:**

```json
{
  "workflowId": "review-orch-post-456-a1b2c3d4",
  "message": "Workflow started"
}
```

**Response 400:**

```json
{ "error": "contentId and content are required" }
```

The workflow ID is deterministic: `review-orch-{contentId}-{guid}`. The workflow runs on the `lt-review-orch` orchestrator queue.

### Start a document verification workflow

```
POST /api/workflows/verify-document
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `documentId` | `string` | yes | Identifier for the document to verify |

**Example request:**

```json
{ "documentId": "DOC-001" }
```

**Response 202:**

```json
{
  "workflowId": "verify-orch-DOC-001-e5f6g7h8",
  "message": "Workflow started"
}
```

**Response 400:**

```json
{ "error": "documentId is required" }
```

### Get workflow status

```
GET /api/workflows/:workflowId/status
```

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `taskQueue` | `lt-review-orch` | Task queue the workflow runs on |
| `workflowName` | `reviewContentOrchestrator` | Registered workflow function name |

**Response 200:**

```json
{
  "workflowId": "review-orch-post-456-a1b2c3d4",
  "status": 0
}
```

Status is a numeric semaphore from HotMesh: `0` means complete, a positive value means running, a negative value means interrupted.

### Await workflow result

```
GET /api/workflows/:workflowId/result
```

Blocks until the workflow completes and returns the result.

**Query parameters:** Same as `/status`.

**Response 200:**

```json
{
  "workflowId": "review-orch-post-456-a1b2c3d4",
  "result": {
    "approved": true,
    "analysis": { "confidence": 0.92 }
  }
}
```

### Export workflow state

```
GET /api/workflows/:workflowId/export
```

Convenience alias that delegates to the export service. For full control over facet filtering, use the dedicated [`/api/workflow-states/:workflowId`](exports.md) endpoint.

**Query parameters:** Same as `/status`.

**Response 200:** Raw workflow state object from HotMesh.
