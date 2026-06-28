# Escalations API

Escalations represent human intervention requests. When a workflow returns `type: 'escalation'`, the interceptor creates an escalation record in `lt_escalations`. The escalation stays in the queue until a human (or another agent) claims and resolves it, which restarts the workflow with the resolver's payload. All endpoints require authentication.

## Escalation Lifecycle

```
pending ──► claimed ──► resolved
   │           │
   │           └──► (claim expires) ──► pending (available again)
   │
   └──► cancelled  (workflow terminated or explicit cancel)
```

Claiming is implicit: `assigned_to` is set and `assigned_until` is set to a future timestamp. When the claim expires, the escalation becomes available again without any status change — it remains `pending`.

`cancelled` is a terminal state. A cancelled escalation cannot be claimed, resolved, or re-cancelled. When a workflow is terminated (`POST /api/workflows/:workflowId/terminate`), HotMesh automatically cancels any pending escalations tied to that workflow. Escalations can also be cancelled directly via `POST /api/escalations/:id/cancel`.

## Work-Surface Scope

A role is a task queue with four verbs — **search** (list/get), **claim**, **ack** (resolve), **delete** (cancel). A `member`'s grant carries `read_scope` (`self` | `all`) and `write_scope` (`none` | `self` | `all`) that set the breadth of those verbs on a given role's escalations. `admin` and `superadmin` ignore scope and act on the whole queue.

- `read_scope` governs which escalations a member **sees** — list, `/available`, get-by-id, find-by-metadata, and stats. `self` means escalations assigned to the member (`assigned_to = user`); `all` means the whole role queue.
- `write_scope` governs which escalations a member may **act on** — claim, resolve, cancel. `self` means only items already assigned to them; `none` is read-only.
- Releasing and escalating are queue-management verbs and require `write_scope=all`. Creating a standalone escalation (`POST /api/escalations`) requires `write_scope=all` or global escalation access.

Defaults are `read_scope=all` and `write_scope=all` — the full-queue worker — so a plain `member` works the whole queue. See [Work-Surface Scope](roles.md#work-surface-scope) in the Roles API for the five member profiles and the **write ⊆ read** constraint.

## List escalations

```
GET /api/escalations
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | `pending`, `resolved`, or `cancelled` |
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

**Scope:** Enforces read scope. A `member` with `read_scope=self` sees only escalations assigned to them; an item outside their read surface returns 404.

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

**Scope:** Governed by write scope. A `member` with `write_scope=self` may claim only items already assigned to them; `write_scope=none` cannot claim.

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

**Scope:** Governed by write scope (resolve is the **ack** verb). A `member` with `write_scope=self` may resolve only items assigned to them; `write_scope=none` cannot resolve.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `resolverPayload` | `object` | yes | The reviewer's decision — injected into `envelope.resolver` |
| `metadata` | `object` | no | Outcome facets merged into the escalation's GIN-indexed metadata. Records *what happened* (disposition, timing) next to *what was asked*; `@>`-queryable. Distinct from `resolverPayload`, which resumes the workflow and is not indexed |

**Example request:**

```json
{
  "resolverPayload": {
    "approved": true,
    "notes": "Content is fine, AI was overly cautious"
  },
  "metadata": {
    "outcome": "approved",
    "reviewedBy": "alice",
    "durationMs": 1240
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
{ "error": "Escalation is cancelled" }
```

Returned when the escalation was cancelled (workflow terminated or explicit cancel). Cannot be resolved.

```json
{ "error": "Escalation not available for resolution" }
```

Returned when the escalation has already been resolved or is otherwise not pending.

### Signal-based resolution (metadata.signal_id)

When an escalation has `metadata.signal_id`, the resolve endpoint signals the running workflow instead of starting a new one. The workflow is still alive — it called `conditionLT(signalId)` and is paused.

The resolver payload is augmented with `$escalation_id` before signaling:

```json
{ "approved": true, "notes": "Looks good", "$escalation_id": "esc-a1b2c3d4-..." }
```

The workflow is responsible for resolving the escalation. The `conditionLT()` helper handles this automatically — it strips `$escalation_id`, calls `ltResolveEscalation` as a durable activity, and returns the clean payload.

If you use raw `Durable.workflow.condition()` instead, you must resolve the escalation yourself using the `$escalation_id` from the signal data.

### Signal-key resolution (efficient/atomic — `signal_key`)

When an escalation was written atomically by `conditionLT(signalId, config)` (or `Durable.workflow.condition(signalId, config)`), the row carries a `signal_key` and no `signal_id`/`signal_routing` metadata. The resolve endpoint detects `signal_key` and resolves it through the SDK: the resolve marks the row resolved **and** delivers the signal to the waiting `condition()` in one transaction, so the original job resumes in place — no re-run, no separate resolve activity. `system.escalation.{id}.resolved` fires.

```
POST /api/escalations/resolve-by-signal-key
```

For callers that know the deterministic signal id (webhooks — e.g. `signal-scan-ar-${orderId}`) and want to skip the id lookup.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signalKey` | `string` | yes | The signal id passed to `conditionLT(signalId, config)` |
| `resolverPayload` | `object` | yes | The decision payload delivered to the waiting workflow |
| `metadata` | `object` | no | Outcome facets merged into the row's GIN-indexed metadata (see [Resolve an escalation](#resolve-an-escalation)) |

Returns `404` when the key is unknown, `409` when the escalation is already terminal, and `200 { signaled: true }` on success. RBAC-scoped to the caller's visible roles.

### What happens during resolution

> Applies to the **re-run** path (an escalation with no `signal_id`, `signal_routing`, or `signal_key`). Signal-based and signal-key escalations resume the live workflow in place, as described above.

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

Aggregated escalation statistics. RBAC-scoped: superadmins see all; others see only their roles. The aggregate reflects `read_all` memberships only — a member's `read_scope=self` items are not aggregated here, since self-scope members get the single-item surface rather than a queue dashboard.

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

Reassign a single escalation to a different role. The caller must be authorized to escalate from the current role to the target role (checked via escalation chains). Escalating is a queue-management verb and requires `write_scope=all` for a `member`.

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

## Cancel an escalation

```
POST /api/escalations/:id/cancel
```

Permanently cancels a pending or claimed escalation. The workflow waiting on this escalation (via `conditionLT`) receives `null` as the condition result, allowing it to handle the cancellation gracefully.

Terminal escalations (`resolved` or already `cancelled`) return 409.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Escalation UUID |

**Request body:** None.

**Response 200:** The cancelled escalation object.

**Response 404:**

```json
{ "error": "Escalation not found" }
```

**Response 409:**

```json
{ "error": "Escalation already resolved or cancelled" }
```

**Auth:** Requires admin or superadmin for the escalation's role.

---

## Bulk cancel escalations

```
POST /api/escalations/bulk-cancel
```

Cancel multiple escalations at once. Skips any that are already terminal.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | yes | Escalation UUIDs to cancel |

**Example request:**

```json
{ "ids": ["esc-a1b2c3d4-...", "esc-e5f6a7b8-..."] }
```

**Response 200:**

```json
{ "cancelled": 2, "skipped": 0 }
```

`skipped` counts escalations that were already terminal (resolved or cancelled) at call time.

**Response 400:**

```json
{ "error": "ids must be a non-empty array" }
```

**Auth:** Requires admin or superadmin for the escalation roles.

---

## Release a claim

```
POST /api/escalations/:id/release
```

Release a claimed escalation back to the available pool. Only the user who holds the current claim can release it. Releasing is a queue-management verb and requires `write_scope=all` for a `member`.

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
| `status` | `string` | `pending`, `resolved`, or `cancelled` |
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

---

## Metadata Candidate Key Operations

These endpoints find, claim, and resolve escalations using a business-domain key stored in the `metadata` JSONB column (e.g., `orderId`). No raw SQL needed — the GIN index makes lookups fast.

All three endpoints accept an optional `assignee` field — an `external_id` from your auth system. Long Tail resolves it to an internal userId. When omitted, the authenticated caller is used.

### Find by metadata

```
GET /api/escalations/by-metadata?key=orderId&value=order-123
```

Scoped to the caller's read access. A `member` with `read_scope=self` matches only escalations assigned to them.

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | **Required.** Metadata field name |
| `value` | `string` | **Required.** Metadata field value |
| `status` | `string` | Filter by status (`pending`, `resolved`, `cancelled`) |
| `limit` | `integer` | Max results (default 50) |
| `offset` | `integer` | Pagination offset (default 0) |

**Response 200:**

```json
{
  "escalations": [{ "id": "...", "type": "order", "role": "operator", "metadata": { "orderId": "order-123" }, ... }],
  "total": 1
}
```

### Claim by metadata

```
POST /api/escalations/claim-by-metadata
```

Finds one available (pending + unassigned/expired) escalation matching the metadata and claims it atomically.

**Scope:** For non-global callers this is scoped to `write_scope=all` roles. Self-scope members are excluded here — their items are pre-claimed and resolved by id, not discovered through the queue.

**Body:**

```json
{
  "key": "orderId",
  "value": "order-123",
  "durationMinutes": 30,
  "metadata": { "claimedBy": "jimbo", "station": "scanning" }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | **Required.** Metadata field name |
| `value` | `string` | **Required.** Metadata field value |
| `durationMinutes` | `number` | Claim duration (default 30) |
| `assignee` | `string` | Claim as a Long Tail user (resolved via `getUserByExternalId`) |
| `metadata` | `object` | Additional metadata to merge (new keys added, existing overwritten) |
| `provisionIfAbsent` | `object` | JIT-provision the assignee if they don't exist (superadmin only) |

**`provisionIfAbsent`** — when the `assignee` doesn't exist in `lt_users` or lacks the escalation's role, provision them inline. Each role entry accepts optional `read_scope` and `write_scope`, so a global caller can JIT-provision a one-time user with `read_scope=self` + `write_scope=self` and pre-claim their item in the same call:

```json
{
  "key": "orderId",
  "value": "order-123",
  "assignee": "new-user",
  "provisionIfAbsent": {
    "displayName": "New User",
    "email": "new-user@example.com",
    "roles": [{ "role": "operator", "type": "member", "read_scope": "self", "write_scope": "self" }]
  }
}
```

Only callers with global escalation access (superadmin, admin/admin) can use this flag. The user is created with the declared roles if absent. If the user exists but lacks a required role, the role is added. The happy path (user exists, has role) adds zero extra queries. A user provisioned at `read_self` + `write_self` sees and acts on exactly the one item the workflow routed to them.

**Response 200:**

```json
{
  "escalation": { "id": "...", "assigned_to": "user-uuid", "assigned_until": "2025-01-15T10:30:00Z", ... },
  "isExtension": false
}
```

**Response 404:** No pending escalation found. **Response 409:** Escalation not available (already claimed).

### Resolve by metadata

```
POST /api/escalations/resolve-by-metadata
```

Single atomic query finds the pending escalation by metadata, auto-claims if unclaimed, and resolves it. RBAC is enforced in the SQL WHERE clause. Write scope is honored here: a `member` with `write_scope=self` may resolve their own assigned item atomically, which is how a one-time user completes the form routed to them.

**Signal guard:** If the escalation has `metadata.signal_id` (created by `conditionLT`), the SQL does NOT resolve it directly. Instead, the endpoint signals the running workflow — `conditionLT` receives the signal and resolves the escalation durably inside the workflow. This preserves the same transactional integrity as the standard resolve-by-ID path.

**Body:**

```json
{
  "key": "orderId",
  "value": "order-123",
  "resolverPayload": { "approved": true, "targetStatus": "completed" },
  "metadata": { "completedBy": "jimbo" }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | **Required.** Metadata field name |
| `value` | `string` | **Required.** Metadata field value |
| `resolverPayload` | `object` | **Required.** Resolution data passed to the workflow |
| `assignee` | `string` | Resolve as a Long Tail user (resolved via `getUserByExternalId`) |
| `metadata` | `object` | Additional metadata to merge (new keys added, existing overwritten) |

**Response 200 (non-signal):** Escalation resolved atomically.

```json
{
  "escalation": { "id": "...", "status": "resolved", ... }
}
```

**Response 200 (signal-backed):** Workflow signaled; `conditionLT` resolves the escalation durably.

```json
{
  "signaled": true,
  "escalationId": "...",
  "workflowId": "..."
}
```

## Resolve a set of escalations

```
POST /api/escalations/resolve-by-ids
```

Resolve many escalations in one guarded statement — the set-based sibling of `POST /:id/resolve`. Used for bookkeeping rows that are woken collectively (it does not deliver a per-row signal). RBAC: a scoped caller may only resolve rows whose role they hold (global principals are unrestricted).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | yes | Escalation ids to resolve as one set |
| `resolverPayload` | `object` | yes | Payload applied to every row |
| `metadata` | `object` | no | Outcome patch merged into each row's GIN-indexed metadata |

**Response 200:** `{ "resolved": <count>, "escalationIds": [...] }` — only the rows that were still `pending` are resolved and returned.

## Faceted search

```
POST /api/escalations/search-by-facets
```

Item-level faceted search over a single pond `role`, scoped to the caller's role. The body is a faceted query.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | yes | Pond role to search |
| `status` | `string` | no | e.g. `pending` |
| `available` | `boolean` | no | Only rows not currently claimed |
| `facets` | `object` | no | Metadata facet equality filters |
| `orderBy` | `{ column, direction }[]` | no | Sort order |
| `limit` / `offset` | `integer` | no | Paging |

**Response 200:** `{ "escalations": [...], "total": <n> }`.

## Claim groups

```
POST /api/escalations/claim-groups
```

Batch-claim complete origin groups (e.g. all units of an order) in priority order over a pond, assigned to the caller. RBAC-scoped to the pond role.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | FacetQuery | yes | The pond/facet selector (see search-by-facets) |
| `limit` | `integer` | no | Max groups to claim |
| `durationMinutes` | `integer` | no | Claim TTL |
| `sizeFacet` | `string` | no | Metadata key holding the group size |

**Response 200:** `{ "groups": [...] }`.

## Claim by facets

```
POST /api/escalations/claim-by-facets
```

Batch-claim individual rows matching a facet query (`FOR UPDATE SKIP LOCKED`), assigned to the caller. With `allOrNone`, commits only when the full `limit` is acquired. RBAC-scoped to the pond role.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | FacetQuery | yes | The pond/facet selector |
| `limit` | `integer` | no | Max rows to claim |
| `durationMinutes` | `integer` | no | Claim TTL |
| `allOrNone` | `boolean` | no | Commit only if the full set was acquired |

**Response 200:** `{ "claimed": [...] }`.
