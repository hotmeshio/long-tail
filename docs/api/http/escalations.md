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

### Signal-based resolution (metadata.signal_id)

When an escalation has `metadata.signal_id`, the resolve endpoint signals the running workflow instead of starting a new one. The workflow is still alive — it called `conditionLT(signalId)` and is paused.

The resolver payload is augmented with `$escalation_id` before signaling:

```json
{ "approved": true, "notes": "Looks good", "$escalation_id": "esc-a1b2c3d4-..." }
```

The workflow is responsible for resolving the escalation. The `conditionLT()` helper handles this automatically — it strips `$escalation_id`, calls `ltResolveEscalation` as a durable activity, and returns the clean payload.

If you use raw `Durable.workflow.condition()` instead, you must resolve the escalation yourself using the `$escalation_id` from the signal data.

### What happens during resolution

1. The route reads the escalation record and verifies it is still `pending`.
2. It reconstructs the original workflow envelope from the escalation's `envelope` field (or from the parent task if the escalation envelope is missing).
3. It injects `resolver` (the reviewer's payload) and `lt.escalationId` into the envelope.
4. It starts a new workflow with the modified envelope on the original task queue.
5. The LT interceptor detects `envelope.lt.escalationId`, marks the escalation as resolved, and signals the parent orchestrator (if any) that the child workflow has completed.

## Resolver form schemas

When a reviewer claims an escalation, the dashboard renders a typed form instead of a raw JSON editor — if a schema is available. There are two ways to attach a schema:

### Option 1: Workflow config (static)

Register a `resolver_schema` in the workflow registry wizard (Step 3, Certification). Every escalation from that workflow type inherits the schema automatically.

### Option 2: Escalation metadata (dynamic)

Pass `form_schema` inside `metadata` when creating an escalation. This overrides any workflow-level schema and is useful for one-off or dynamically generated forms.

```json
{
  "type": "approval",
  "role": "reviewer",
  "description": "Review deployment to production",
  "metadata": {
    "form_schema": {
      "properties": {
        "approved": {
          "type": "boolean",
          "default": false,
          "description": "Approve this deployment?"
        },
        "environment": {
          "type": "string",
          "enum": ["staging", "production"],
          "description": "Target environment"
        },
        "api_key": {
          "type": "string",
          "format": "password",
          "description": "Deployment API key (stored as ephemeral token)"
        },
        "notes": {
          "type": "string",
          "default": "",
          "description": "Optional reviewer notes"
        },
        "confidence": {
          "type": "number",
          "default": 0,
          "description": "Confidence score (0-1)"
        }
      }
    }
  }
}
```

### Supported field features

| Schema property | Effect |
|----------------|--------|
| `type` | Inferred from value at runtime; hints only |
| `default` | Pre-fills the form field |
| `description` | Helper text displayed below the field label |
| `enum` | Renders a dropdown select instead of free text |
| `format: "password"` | Masks input; value is replaced with a 15-minute ephemeral token on resolution (never stored as plaintext) |

### Field type rendering

The dashboard infers field types from the default value:

| Value type | Renders as |
|-----------|------------|
| `boolean` | Checkbox |
| `number` | Number input |
| `string` (short) | Text input |
| `string` (>80 chars) | Textarea |
| `string` + `enum` | Dropdown select |
| `string` + `format: "password"` | Password input |
| `null` | Disabled placeholder |
| `array` | Read-only tag list |
| `object` | Nested section with recursive field rendering |

### Hidden fields

Keys prefixed with `_` (e.g., `_internal_id`) are stored in the payload but hidden from the form UI. The `_form_schema` key is reserved — the dashboard stores the schema itself there for round-trip access during resolution.

### Schema priority

When both exist, `metadata.form_schema` takes precedence over `resolver_schema` from the workflow config. This lets workflows define a default form while allowing individual escalations to override it.

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

## Get escalation types

```
GET /api/escalations/types
```

Returns distinct escalation type values across all escalations.

**Response 200:**

```json
{
  "types": ["review", "approval", "verification"]
}
```

## Get escalation stats

```
GET /api/escalations/stats
```

Aggregated escalation statistics. RBAC-scoped: superadmins see all; others see only their roles.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | `string` | Time period filter (e.g., `24h`, `7d`) |

**Response 200:**

```json
{
  "pending": 12,
  "claimed": 3,
  "created": 25,
  "resolved": 10,
  "by_role": [],
  "by_type": []
}
```

## Bulk update priority

```
PATCH /api/escalations/priority
```

Update the priority for multiple escalations at once. Requires admin or superadmin permission for the escalation roles.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | yes | Escalation UUIDs to update |
| `priority` | `integer` | yes | New priority value (1, 2, 3, or 4) |

**Example request:**

```json
{ "ids": ["esc-a1b2c3d4-...", "esc-e5f6a7b8-..."], "priority": 1 }
```

**Response 200:**

```json
{ "updated": 2 }
```

**Response 400:**

```json
{ "error": "ids must be a non-empty array" }
```

```json
{ "error": "priority must be 1, 2, 3, or 4" }
```

**Response 403:**

```json
{ "error": "Insufficient permissions for role \"reviewer\"" }
```

## Bulk claim escalations

```
POST /api/escalations/bulk-claim
```

Claim multiple escalations for the authenticated user. Requires admin or superadmin permission for the escalation roles.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ids` | `string[]` | | Escalation UUIDs to claim |
| `durationMinutes` | `integer` | 30 | How long each claim lasts |

**Example request:**

```json
{ "ids": ["esc-a1b2c3d4-...", "esc-e5f6a7b8-..."], "durationMinutes": 60 }
```

**Response 200:** Result object with claim outcomes.

**Response 400:**

```json
{ "error": "ids must be a non-empty array" }
```

## Bulk assign escalations

```
POST /api/escalations/bulk-assign
```

Assign multiple escalations to a specific user. Superadmins can assign anyone. Admins can only assign to users who hold the escalation's role.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ids` | `string[]` | | Escalation UUIDs to assign |
| `targetUserId` | `string` | | User ID to assign the escalations to |
| `durationMinutes` | `integer` | 30 | How long each assignment lasts |

**Example request:**

```json
{ "ids": ["esc-a1b2c3d4-..."], "targetUserId": "user-x1y2z3", "durationMinutes": 60 }
```

**Response 200:** Result object with assignment outcomes.

**Response 400:**

```json
{ "error": "targetUserId is required" }
```

```json
{ "error": "Target user does not hold the \"reviewer\" role" }
```

## Bulk escalate to role

```
PATCH /api/escalations/bulk-escalate
```

Reassign multiple escalations to a different role. Requires admin or superadmin permission for the current escalation roles.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | yes | Escalation UUIDs to reassign |
| `targetRole` | `string` | yes | Role to reassign the escalations to |

**Example request:**

```json
{ "ids": ["esc-a1b2c3d4-...", "esc-e5f6a7b8-..."], "targetRole": "senior-reviewer" }
```

**Response 200:**

```json
{ "updated": 2 }
```

**Response 400:**

```json
{ "error": "targetRole is required" }
```

## Bulk triage escalations

```
POST /api/escalations/bulk-triage
```

Resolve multiple escalations and start AI triage workflows (mcpTriage) for each. Requires admin or superadmin permission for the escalation roles.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | yes | Escalation UUIDs to triage |
| `hint` | `string` | no | Optional hint to guide the AI triage |

**Example request:**

```json
{ "ids": ["esc-a1b2c3d4-..."], "hint": "Check the document orientation" }
```

**Response 200:**

```json
{
  "triaged": 1,
  "workflows": ["triage-esc-a1b2c3d4-...-1705312800000"]
}
```

## Escalate to role (single)

```
PATCH /api/escalations/:id/escalate
```

Reassign a single escalation to a different role. The caller must be authorized to escalate from the current role to the target role (checked via escalation chains).

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Escalation UUID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targetRole` | `string` | yes | Role to reassign the escalation to |

**Example request:**

```json
{ "targetRole": "senior-reviewer" }
```

**Response 200:** The updated escalation object with the new role.

**Response 400:**

```json
{ "error": "targetRole is required" }
```

**Response 403:**

```json
{ "error": "Not authorized to escalate to this role" }
```

**Response 404:**

```json
{ "error": "Escalation not found" }
```

**Response 409:**

```json
{ "error": "Escalation is not pending" }
```

## Get escalations by workflow

```
GET /api/escalations/by-workflow/:workflowId
```

Returns all escalations linked to a specific workflow ID.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `workflowId` | Workflow ID to search for |

**Response 200:**

```json
{
  "escalations": [
    { "id": "esc-a1b2c3d4-...", "..." : "..." }
  ]
}
```

## Release a claim

```
POST /api/escalations/:id/release
```

Release a claimed escalation back to the available pool. Only the user who holds the current claim can release it.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Escalation UUID |

**Request body:** None.

**Response 200:**

```json
{
  "escalation": { "id": "esc-a1b2c3d4-...", "assigned_to": null, "assigned_until": null, "..." : "..." }
}
```

**Response 409:**

```json
{ "error": "Escalation not found or not claimed by you" }
```

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
