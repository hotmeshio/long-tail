# Escalations API

Escalations represent human intervention requests. When a workflow returns `type: 'escalation'`, the interceptor creates an escalation record in `lt_escalations`. The escalation stays in the queue until a human (or another agent) claims and resolves it, which restarts the workflow with the resolver's payload. All endpoints require authentication.

## Escalation Lifecycle

```
pending ──► claimed ──► resolved
              │
              └──► (claim expires) ──► pending (available again)
```

Claiming is implicit: `assigned_to` is set and `assigned_until` is set to a future timestamp. When the claim expires, the escalation becomes available again without any status change — it remains `pending`.

## List escalations

```
GET /api/escalations
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | `pending` or `resolved` |
| `role` | `string` | Filter by target role |
| `type` | `string` | Filter by escalation type |
| `subtype` | `string` | Filter by subtype |
| `assigned_to` | `string` | Filter by claimer's user ID |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:**

```json
{
  "escalations": [
    {
      "id": "esc-a1b2c3d4-...",
      "type": "review",
      "subtype": "content",
      "modality": "default",
      "description": "Review needed (confidence: 0.72)",
      "status": "pending",
      "priority": 2,
      "task_id": "d4e5f6a7-...",
      "origin_id": "review-orch-post-456-a1b2c3d4",
      "parent_id": null,
      "workflow_id": "review-post-456-x9y8z7",
      "task_queue": "long-tail",
      "workflow_type": "reviewContent",
      "role": "reviewer",
      "assigned_to": null,
      "assigned_until": null,
      "resolved_at": null,
      "claimed_at": null,
      "envelope": "{\"data\":{\"contentId\":\"post-456\"},\"metadata\":{}}",
      "metadata": null,
      "escalation_payload": "{\"content\":\"...\",\"analysis\":{\"confidence\":0.72}}",
      "resolver_payload": null,
      "created_at": "2025-01-15T10:00:05.000Z",
      "updated_at": "2025-01-15T10:00:05.000Z"
    }
  ],
  "total": 1
}
```

## List available escalations

```
GET /api/escalations/available
```

Returns only escalations that are `pending` and either unassigned or have an expired claim. This is the endpoint a reviewer calls to check their queue.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `role` | `string` | Filter by target role |
| `type` | `string` | Filter by escalation type |
| `subtype` | `string` | Filter by subtype |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Example request:**

```
GET /api/escalations/available?role=reviewer
```

**Response 200:** Same shape as the list endpoint, but only includes available escalations.

## Get escalation details

```
GET /api/escalations/:id
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Escalation UUID |

**Response 200:** A single escalation object.

**Response 404:**

```json
{ "error": "Escalation not found" }
```

## Claim an escalation

```
POST /api/escalations/:id/claim
```

Locks the escalation so no other reviewer can pick it up. The lock is time-boxed — if the reviewer doesn't resolve it within the duration, the escalation returns to the available queue automatically.

The `userId` is read from the auth token (`req.auth.userId`), not from the request body.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `durationMinutes` | `integer` | 30 | How long the claim lasts |

**Example request:**

```json
{ "durationMinutes": 60 }
```

**Response 200:** The updated escalation object with `assigned_to`, `assigned_until`, and `claimed_at` populated.

**Response 409:**

```json
{ "error": "Escalation not available for claim" }
```

Returned when the escalation is already claimed (by someone else, with an unexpired lock) or has already been resolved.

## Resolve an escalation

```
POST /api/escalations/:id/resolve
```

Resolving an escalation starts a new workflow execution with the resolver's payload injected into `envelope.resolver`. The workflow re-runs, hits the `if (envelope.resolver)` branch, and completes with the human's decision as the final result.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolverPayload` | `object` | yes | The reviewer's decision — injected into `envelope.resolver` |

**Example request:**

```json
{
  "resolverPayload": {
    "approved": true,
    "notes": "Content is fine, AI was overly cautious"
  }
}
```

**Response 200:**

```json
{
  "started": true,
  "escalationId": "esc-a1b2c3d4-...",
  "workflowId": "rerun-esc-a1b2c3d4-...-1705312800000"
}
```

The new workflow ID follows the pattern `rerun-{escalationId}-{timestamp}`.

**Response 400:**

```json
{ "error": "resolverPayload is required" }
```

**Response 404:**

```json
{ "error": "Escalation not found" }
```

**Response 409:**

```json
{ "error": "Escalation not available for resolution" }
```

Returned when the escalation has already been resolved.

### What happens during resolution

1. The route reads the escalation record and verifies it is still `pending`.
2. It reconstructs the original workflow envelope from the escalation's `envelope` field (or from the parent task if the escalation envelope is missing).
3. It injects `resolver` (the reviewer's payload) and `lt.escalationId` into the envelope.
4. It starts a new workflow with the modified envelope on the original task queue.
5. The LT interceptor detects `envelope.lt.escalationId`, marks the escalation as resolved, and signals the parent orchestrator (if any) that the child workflow has completed.

## Release expired claims

```
POST /api/escalations/release-expired
```

Clears `assigned_to` and `assigned_until` on escalations where the claim has expired. This is optional — the `/available` endpoint already filters out expired claims at query time. This endpoint exists for housekeeping if you want to clean up the assignment fields explicitly.

**Request body:** None.

**Response 200:**

```json
{ "released": 3 }
```

The number indicates how many escalation records were updated.

## Escalation fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `UUID` | Primary key |
| `type` | `string` | Escalation category |
| `subtype` | `string` | Subcategory for finer routing |
| `modality` | `string` | Modality from workflow config |
| `description` | `string` | Human-readable reason |
| `status` | `string` | `pending` or `resolved` |
| `priority` | `integer` | Numeric priority |
| `task_id` | `UUID` | FK to the task that triggered this escalation |
| `origin_id` | `string` | Correlation ID from the parent orchestrator |
| `parent_id` | `string` | Direct parent workflow ID |
| `workflow_id` | `string` | HotMesh workflow ID |
| `task_queue` | `string` | Task queue (needed for resolution re-run) |
| `workflow_type` | `string` | Workflow name (needed for resolution re-run) |
| `role` | `string` | Target role |
| `assigned_to` | `string` | Claimer's user ID |
| `assigned_until` | `ISO 8601` | Claim expiry |
| `resolved_at` | `ISO 8601` | When the escalation was resolved |
| `claimed_at` | `ISO 8601` | When the escalation was claimed |
| `envelope` | `string` | JSON-serialized original workflow envelope |
| `metadata` | `object` | Arbitrary metadata |
| `escalation_payload` | `string` | JSON data the workflow attached to the escalation |
| `resolver_payload` | `string` | JSON decision from the human reviewer |

See [Data Model](../data.md) for the full SQL schema and index strategy.
