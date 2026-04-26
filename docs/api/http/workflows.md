# Workflows API

The workflow API covers the full lifecycle: configure a workflow, invoke it, observe its progress, and export its durable execution history. All endpoints require authentication. Responses use `application/json`.

---

## Discovery

### List active workers

```
GET /api/workflows/workers
```

Returns all in-memory workflow workers with their registration status (whether a config exists in `lt_config_workflows`).

**Response 200:**

```json
{
  "workers": [
    {
      "name": "reviewContent",
      "taskQueue": "long-tail",
      "registered": true
    }
  ]
}
```

### List discovered workflows

```
GET /api/workflows/discovered
```

Returns a unified list that merges active workers, historical workflow entities from the durable store, and workflow configurations. Each entry includes a `registered` boolean indicating whether a config exists.

**Response 200:**

```json
{
  "workflows": [
    {
      "name": "reviewContent",
      "taskQueue": "long-tail",
      "registered": true,
      "config": { "..." }
    }
  ]
}
```

---

## Configuration

Workflow configuration lives in Postgres (`lt_config_workflows`) and drives everything: which workflows the interceptor manages, who can escalate, who can invoke, and what data flows between steps.

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
      "invocable": true,
      "task_queue": "long-tail",
      "default_role": "reviewer",
      "default_modality": "default",
      "description": "AI content review with human escalation",
      "consumes": [],
      "execute_as": null,
      "tool_tags": [],
      "envelope_schema": null,
      "resolver_schema": null,
      "cron_schedule": null,
      "roles": ["reviewer"],
      "invocation_roles": ["submitter"],
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

Requires `admin` or `superadmin` role.

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
| `invocable` | `boolean` | `false` | Allow this workflow to be started via `POST /api/workflows/:type/invoke` |
| `task_queue` | `string \| null` | `null` | Task queue name (required for invocable workflows) |
| `default_role` | `string` | `"reviewer"` | Role assigned to escalations when the workflow doesn't specify one |
| `description` | `string \| null` | `null` | Human-readable description |
| `roles` | `string[]` | `[]` | Roles allowed to claim escalations for this workflow |
| `invocation_roles` | `string[]` | `[]` | Roles allowed to invoke via API. Empty = any authenticated user. |
| `consumes` | `string[]` | `[]` | Workflow types whose completed data this workflow receives via `envelope.lt.providers` |
| `execute_as` | `string \| null` | `null` | Service account `external_id` to run as (overrides invoker identity) |
| `tool_tags` | `string[]` | `[]` | MCP tool tags for scoped tool discovery |
| `envelope_schema` | `object \| null` | `null` | JSON Schema for the workflow input envelope |
| `resolver_schema` | `object \| null` | `null` | JSON Schema for the escalation resolver payload |
| `cron_schedule` | `string \| null` | `null` | Cron expression for scheduled execution (e.g., `"0 9 * * *"`) |

**Example request:**

```json
{
  "invocable": true,
  "task_queue": "long-tail",
  "default_role": "reviewer",
  "roles": ["reviewer", "senior-reviewer"],
  "invocation_roles": ["submitter", "admin"],
  "consumes": ["extractDocument"]
}
```

**Response 200:** The created or updated config object.

This endpoint is idempotent. It replaces the entire configuration, including roles and invocation roles (cascade delete + re-insert). It also invalidates the in-memory config cache.

### Delete a workflow configuration

Requires `admin` or `superadmin` role.

```
DELETE /api/workflows/:type/config
```

Deletes the workflow config and all associated roles and invocation roles (cascade).

**Response 200:**

```json
{ "deleted": true, "workflow_type": "reviewContent" }
```

**Response 404:**

```json
{ "error": "Workflow config not found" }
```

---

## Invocation

### Invoke a workflow

```
POST /api/workflows/:type/invoke
```

Start a workflow by its registered type. The workflow must have `invocable: true` in its configuration.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `type` | Workflow type name (e.g., `reviewContent`) |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | `object` | yes | Business data passed to the workflow as `envelope.data` |
| `metadata` | `object` | no | Control flow metadata passed as `envelope.metadata` |
| `execute_as` | `string` | no | Service account `external_id` to run as (admin only) |

**Example request:**

```json
{
  "data": {
    "contentId": "post-456",
    "content": "This article discusses the impact of...",
    "contentType": "article"
  }
}
```

**Response 202:**

```json
{
  "workflowId": "reviewContent-a1b2c3d4",
  "message": "Workflow started"
}
```

The workflow starts on its configured `task_queue` with a generated workflow ID (`{type}-{guid}`). The response returns immediately — the workflow runs durably in the background.

**Error responses:**

| Status | Body | Meaning |
|--------|------|---------|
| `400` | `{ "error": "Request body must include a data object" }` | Missing or invalid `data` field |
| `400` | `{ "error": "Workflow has no task_queue configured" }` | Config exists but `task_queue` is null |
| `403` | `{ "error": "Workflow is not invocable" }` | `invocable` is `false` |
| `403` | `{ "error": "User not registered" }` | RBAC check failed — no matching user |
| `403` | `{ "error": "Insufficient role for invocation" }` | User lacks a required invocation role |
| `404` | `{ "error": "Workflow not found" }` | No config exists for this type |

**Authorization:**

When `invocation_roles` is empty, any authenticated user can invoke. When set, the user must hold at least one of the listed roles (checked against `lt_user_roles` via the user's `external_id`). Superadmins bypass this check.

---

## Observation

These endpoints let you check on running or completed workflows. The `workflowId` (returned from the invoke call) is all you need.

### Get workflow status

```
GET /api/workflows/:workflowId/status
```

**Response 200:**

```json
{
  "workflowId": "reviewContent-a1b2c3d4",
  "status": 0
}
```

| Status value | Meaning |
|--------------|---------|
| `0` | Complete |
| Positive | Running |
| Negative | Interrupted |

### Get workflow result

```
GET /api/workflows/:workflowId/result
```

Returns the result if the workflow is complete, or `202` if it's still running. Never blocks.

**Response 200** (complete):

```json
{
  "workflowId": "reviewContent-a1b2c3d4",
  "result": {
    "type": "return",
    "data": {
      "approved": true,
      "analysis": { "confidence": 0.92 }
    },
    "milestones": [
      { "name": "ai_review", "value": "approved" }
    ]
  }
}
```

**Response 202** (still running):

```json
{
  "workflowId": "reviewContent-a1b2c3d4",
  "status": "running"
}
```

---

## Execution History Export

Every workflow's full execution history is exportable in JSON. Two formats are available: a raw state export (HotMesh-native) and a structured execution event history with typed events, ISO timestamps, durations, and cross-references.

Because workflows are durably executed — state is transactionally checkpointed to Postgres after every step — the export is a complete, faithful record of everything that happened. Every activity scheduled, every result returned, every signal received, every child workflow spawned. Nothing is reconstructed or approximated.

### Convenience alias

```
GET /api/workflows/:workflowId/export
```

Returns the raw workflow state from HotMesh. For full control over facet filtering and execution format, use the dedicated `/api/workflow-states` endpoints below.

**Response 200:** Raw workflow state object (data, state, status, timeline, transitions).

### Raw workflow state

```
GET /api/workflow-states/:workflowId
```

Full state export with facet filtering. The response includes five facets: `data`, `state`, `status`, `timeline`, and `transitions`. Use `allow` or `block` to control which facets are returned.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `allow` | `string` | no | Comma-separated allowlist of facets |
| `block` | `string` | no | Comma-separated blocklist of facets |
| `values` | `string` | no | Set to `false` to omit timeline values |

`allow` and `block` are mutually exclusive. If both are provided, `allow` takes precedence.

**Example — only data and status:**

```
GET /api/workflow-states/reviewContent-a1b2c3d4?allow=data,status
```

**Response 200:**

```json
{
  "workflow_id": "reviewContent-a1b2c3d4",
  "data": {
    "contentId": "post-456",
    "approved": true,
    "analysis": { "confidence": 0.92 }
  },
  "status": 0
}
```

### Structured execution history

```
GET /api/workflow-states/:workflowId/execution
```

Exports the workflow's execution as a sequence of typed events. Each event has an `eventType`, an ISO timestamp, and typed attributes. Activity events include durations and cross-reference the scheduling event via `scheduledEventId`. The response ends with a `summary` that captures total event count, wall-clock duration, and final status.

This is the primary export format for auditing, debugging, and building dashboards over durable workflow executions.

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `excludeSystem` | `string` | no | `false` | `true` to omit LT interceptor activities (`lt*`) |
| `omitResults` | `string` | no | `false` | `true` to strip activity result payloads |
| `mode` | `string` | no | `sparse` | `sparse` = flat event list, `verbose` = nested child workflows |
| `maxDepth` | `integer` | no | `5` | Recursion depth limit for verbose mode |

**Event types:**

| Event type | Description |
|------------|-------------|
| `workflow_execution_started` | Workflow began — includes input arguments |
| `activity_task_scheduled` | Activity dispatched to a task queue |
| `activity_task_completed` | Activity returned a result — includes duration and `scheduledEventId` |
| `activity_task_failed` | Activity threw an error |
| `child_workflow_execution_started` | Orchestrator spawned a child workflow |
| `child_workflow_execution_completed` | Child workflow returned |
| `child_workflow_execution_failed` | Child workflow failed |
| `timer_started` | Timer (sleep/delay) began |
| `timer_fired` | Timer elapsed |
| `workflow_execution_signaled` | External signal received (e.g., escalation resolution) |
| `workflow_execution_completed` | Workflow finished successfully |
| `workflow_execution_failed` | Workflow failed |

**Example request — clean history without interceptor internals:**

```
GET /api/workflow-states/reviewContent-a1b2c3d4/execution?excludeSystem=true
```

**Response 200:**

```json
{
  "workflowId": "reviewContent-a1b2c3d4",
  "workflowName": "reviewContent",
  "taskQueue": "long-tail",
  "events": [
    {
      "eventId": 1,
      "eventType": "workflow_execution_started",
      "timestamp": "2025-01-15T10:00:00.000Z",
      "details": {
        "input": {
          "data": { "contentId": "post-456" },
          "metadata": {}
        }
      }
    },
    {
      "eventId": 2,
      "eventType": "activity_task_scheduled",
      "timestamp": "2025-01-15T10:00:00.050Z",
      "details": {
        "activityType": "analyzeContent",
        "taskQueue": "long-tail"
      }
    },
    {
      "eventId": 3,
      "eventType": "activity_task_completed",
      "timestamp": "2025-01-15T10:00:02.300Z",
      "details": {
        "scheduledEventId": 2,
        "duration": "2.250s",
        "result": {
          "confidence": 0.92,
          "flags": []
        }
      }
    },
    {
      "eventId": 4,
      "eventType": "workflow_execution_completed",
      "timestamp": "2025-01-15T10:00:02.350Z",
      "details": {
        "result": {
          "approved": true,
          "analysis": { "confidence": 0.92 }
        }
      }
    }
  ],
  "summary": {
    "totalEvents": 4,
    "duration": "2.350s",
    "status": "completed"
  }
}
```

Every event is faithfully reconstructed from the durable execution log — activities are only executed once (their results are checkpointed), so the event history reflects exactly what happened, not a re-execution.

**Verbose mode** includes nested `children` arrays for orchestrator workflows, where each child contains its own full event sequence. Use `maxDepth` to limit recursion for deeply nested orchestrations.

### Workflow status semaphore

```
GET /api/workflow-states/:workflowId/status
```

Returns only the numeric status — useful for lightweight polling.

**Response 200:**

```json
{ "workflow_id": "reviewContent-a1b2c3d4", "status": 0 }
```

| Value | Meaning |
|-------|---------|
| `0` | Complete |
| Positive | Running |
| Negative | Interrupted |

### Workflow state snapshot

```
GET /api/workflow-states/:workflowId/state
```

Returns the current internal job state — the HotMesh representation of where the workflow is in its execution graph. For completed workflows, this is the final output.

**Response 200:** HotMesh job state object. Structure depends on the workflow's current execution point.

### Programmatic access

The same export data is available directly through the Durable client, without going through the HTTP API:

```typescript
import { Durable } from '@hotmeshio/hotmesh';

const client = new Durable.Client({ connection });
const handle = await client.workflow.getHandle(
  taskQueue,
  workflowName,
  workflowId,
);

// Structured execution history
const execution = await handle.exportExecution({
  exclude_system: true,
});

// Raw state export with facet filtering
const state = await handle.export({
  allow: ['data', 'status'],
});

// Status semaphore
const status = await handle.status();

// Current state snapshot
const snapshot = await handle.state(true);
```

---

## Cron Status

### Get cron workflow status

```
GET /api/workflows/cron/status
```

Lists all cron-configured workflows and whether each is actively running.

**Response 200:**

```json
{
  "schedules": [
    {
      "workflow_type": "dailyReport",
      "cron_schedule": "0 9 * * *",
      "description": "Generate daily report",
      "task_queue": "long-tail",
      "invocable": true,
      "active": true,
      "envelope_schema": null
    }
  ]
}
```

---

## Termination

### Terminate a workflow

```
POST /api/workflows/:workflowId/terminate
```

Interrupt a running workflow. The workflow is immediately terminated.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `workflowId` | HotMesh workflow ID |

**Response 200:**

```json
{ "terminated": true, "workflowId": "reviewContent-a1b2c3d4" }
```

---

## Endpoint summary

### `/api/workflows`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/workers` | any | List active in-memory workers with registration status |
| `GET` | `/discovered` | any | Unified list of workers, entities, and configs |
| `GET` | `/cron/status` | any | List cron-configured workflows and active status |
| `GET` | `/config` | any | List all workflow configurations |
| `GET` | `/:type/config` | any | Get a single workflow configuration |
| `PUT` | `/:type/config` | admin | Create or replace a workflow configuration |
| `DELETE` | `/:type/config` | admin | Delete a workflow configuration (cascade) |
| `POST` | `/:type/invoke` | RBAC | Invoke a workflow (requires `invocable: true`) |
| `GET` | `/:workflowId/status` | any | Workflow status |
| `GET` | `/:workflowId/result` | any | Get workflow result (200 if complete, 202 if running) |
| `POST` | `/:workflowId/terminate` | any | Terminate a running workflow |
| `GET` | `/:workflowId/export` | any | Raw state export (convenience alias) |

### `/api/workflow-states`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/:workflowId` | any | Raw state export with facet filtering |
| `GET` | `/:workflowId/execution` | any | Structured execution history |
| `GET` | `/:workflowId/status` | any | Status semaphore |
| `GET` | `/:workflowId/state` | any | Current workflow state snapshot |
