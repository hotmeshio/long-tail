# Exports API

Export endpoints expose workflow state and execution history. The execution history endpoint produces structured, typed events — useful for debugging, auditing, and migrating data. All endpoints require authentication.

Every endpoint resolves the workflow automatically from the `workflowId` — no additional parameters needed.

## Raw workflow state

```
GET /api/workflow-states/:workflowId
```

Exports the full workflow state using HotMesh's durable export. The response includes facets (data, state, status, timeline, transitions) that can be filtered.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `allow` | `string` | no | Comma-separated allowlist of facets: `data`, `state`, `status`, `timeline`, `transitions` |
| `block` | `string` | no | Comma-separated blocklist of facets |
| `values` | `string` | no | Set to `false` to omit timeline values |

`allow` and `block` are mutually exclusive. If both are provided, `allow` takes precedence.

**Example request — only data and status:**

```
GET /api/workflow-states/reviewContent-a1b2c3d4?allow=data,status
```

**Response 200:** Raw workflow state object from HotMesh. Structure varies by facet selection.

**Response 404:**

```json
{ "error": "No task found for workflow \"unknown-id\"" }
```

## Execution history

```
GET /api/workflow-states/:workflowId/execution
```

Exports the workflow's execution history as structured, typed events (`workflow_execution_started`, `activity_task_scheduled`, `activity_task_completed`, etc.) with ISO timestamps, durations, and cross-references.

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `excludeSystem` | `string` | no | `false` | Set to `true` to omit LT interceptor activities (`lt*`) |
| `omitResults` | `string` | no | `false` | Set to `true` to strip activity result payloads |
| `mode` | `string` | no | `sparse` | `sparse` (flat events) or `verbose` (includes nested child workflow executions) |
| `maxDepth` | `integer` | no | `5` | Recursion depth limit for verbose mode |

**Example request — clean execution history without system activities:**

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
        "result": { "confidence": 0.92 }
      }
    },
    {
      "eventId": 4,
      "eventType": "workflow_execution_completed",
      "timestamp": "2025-01-15T10:00:02.350Z",
      "details": {
        "result": { "approved": true }
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

**Verbose mode** includes nested `children` arrays for orchestrator workflows, each containing the child workflow's full event sequence. Use `maxDepth` to limit recursion for deeply nested orchestrations.

## Workflow status

```
GET /api/workflow-states/:workflowId/status
```

Returns the numeric status semaphore from HotMesh.

**Response 200:**

```json
{ "workflow_id": "reviewContent-a1b2c3d4", "status": 0 }
```

| Value | Meaning |
|-------|---------|
| `0` | Complete |
| Positive | Running |
| Negative | Interrupted |

## Workflow state

```
GET /api/workflow-states/:workflowId/state
```

Returns the current job state of the workflow — the internal HotMesh representation of where the workflow is in its execution.

**Response 200:** HotMesh job state object. Structure depends on the workflow's current execution point.

## Programmatic access

The same data is available programmatically through the Durable client:

```typescript
const client = new Durable.Client({ connection });
const handle = await client.workflow.getHandle(
  taskQueue,
  workflowName,
  workflowId,
);

// Execution history
const execution = await handle.exportExecution({
  exclude_system: true,
});

// Raw state export
const state = await handle.export({
  allow: ['data', 'status'],
});
```
