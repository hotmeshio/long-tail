# Exports API

Export endpoints expose workflow state and execution history. The execution history endpoint produces Temporal-compatible typed events — useful for debugging, auditing, and migrating data. All endpoints require authentication.

All endpoints require `taskQueue` and `workflowName` as query parameters because HotMesh uses these, along with the workflow ID, to locate the workflow state.

## Raw workflow state

```
GET /api/workflow-states/:workflowId
```

Exports the full workflow state using HotMesh's durable export. The response includes facets (data, state, status, timeline, transitions) that can be filtered.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskQueue` | `string` | yes | Task queue the workflow runs on |
| `workflowName` | `string` | yes | Registered workflow function name |
| `allow` | `string` | no | Comma-separated allowlist of facets: `data`, `state`, `status`, `timeline`, `transitions` |
| `block` | `string` | no | Comma-separated blocklist of facets |
| `values` | `string` | no | Set to `false` to omit timeline values |

`allow` and `block` are mutually exclusive. If both are provided, `allow` takes precedence.

**Example request — only data and status:**

```
GET /api/workflow-states/review-orch-post-456/
    ?taskQueue=lt-review-orch
    &workflowName=reviewContentOrchestrator
    &allow=data,status
```

**Response 200:** Raw workflow state object from HotMesh. Structure varies by facet selection.

**Response 400:**

```json
{ "error": "taskQueue and workflowName are required" }
```

## Execution history

```
GET /api/workflow-states/:workflowId/execution
```

Exports the workflow's execution history in a Temporal-compatible format. Events are typed (`workflow_execution_started`, `activity_task_scheduled`, `activity_task_completed`, etc.) with ISO timestamps, durations, and cross-references.

**Query parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `taskQueue` | `string` | yes | — | Task queue |
| `workflowName` | `string` | yes | — | Workflow function name |
| `excludeSystem` | `string` | no | `false` | Set to `true` to omit LT interceptor activities (`lt*`) |
| `omitResults` | `string` | no | `false` | Set to `true` to strip activity result payloads |
| `mode` | `string` | no | `sparse` | `sparse` (flat events) or `verbose` (includes nested child workflow executions) |
| `maxDepth` | `integer` | no | `5` | Recursion depth limit for verbose mode |

**Example request — clean execution history without system activities:**

```
GET /api/workflow-states/review-orch-post-456/execution
    ?taskQueue=lt-review-orch
    &workflowName=reviewContentOrchestrator
    &excludeSystem=true
```

**Response 200:**

```json
{
  "workflowId": "review-orch-post-456",
  "workflowName": "reviewContentOrchestrator",
  "taskQueue": "lt-review-orch",
  "events": [
    {
      "eventId": 1,
      "eventType": "workflow_execution_started",
      "timestamp": "2025-01-15T10:00:00.000Z",
      "details": {
        "input": { "data": { "contentId": "post-456" }, "metadata": {} }
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

**Response 400:**

```json
{ "error": "taskQueue and workflowName are required" }
```

## Workflow status

```
GET /api/workflow-states/:workflowId/status
```

Returns the numeric status semaphore from HotMesh.

**Query parameters:**

| Parameter | Type | Required |
|-----------|------|----------|
| `taskQueue` | `string` | yes |
| `workflowName` | `string` | yes |

**Response 200:**

```json
{ "status": 0 }
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

**Query parameters:**

| Parameter | Type | Required |
|-----------|------|----------|
| `taskQueue` | `string` | yes |
| `workflowName` | `string` | yes |

**Response 200:** HotMesh job state object. Structure depends on the workflow's current execution point.

## Programmatic access

The same data is available programmatically through the Durable client:

```typescript
const client = new Durable.Client({ connection });
const handle = await client.workflow.getHandle(taskQueue, workflowName, workflowId);

// Execution history
const execution = await handle.exportExecution({ exclude_system: true });

// Raw state export
const state = await handle.export({ allow: ['data', 'status'] });
```
