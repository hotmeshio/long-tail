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

Admins can override a live claim without touching status: [bulk-assign](#bulk-assign-escalations) with `reassign: true` hands the claim to another user (publishes `claimed`), and [bulk-unassign](#bulk-unassign) returns it to the pool (publishes `released`). The `reassigned` event names the role move ([bulk-escalate](#bulk-escalate-to-role)) only.

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
| `status` | `string` | `pending`, `resolved`, `cancelled`, or `expired` |
| `role` | `string` | Filter by target role |
| `type` | `string` | Filter by escalation type |
| `subtype` | `string` | Filter by subtype |
| `assigned_to` | `string` | Filter by claimer's user ID |
| `priority` | `integer` | Filter by priority (1–4) |
| `search` | `string` | Exact-match by correlation id — escalation id, workflow id, or origin id (server-side, index-served). To match a value inside metadata, use `facets` |
| `sort_by` / `order` | `string` | Single-column sort + direction (`asc`/`desc`) |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Faceted query parameters** (JSON-encoded — a "facet" is a key/value *inside* the row's
`metadata` JSONB; the filter and count run in SQL, role-scoped):

| Parameter | JSON shape | Description |
|-----------|-----------|-------------|
| `facets` | object | Required facets — `metadata @> facets`. `{"flags":"too_short"}` ≡ `metadata.flags == "too_short"` for a top-level scalar (containment for nested/arrays) |
| `block` | array of objects | Exclude rows containing ANY set — `NOT (metadata @> ANY(block))` |
| `range` | array of `{facet, op, value}` | Numeric range, op ∈ `< <= > >= =`, e.g. `[{"facet":"confidence","op":"<=","value":0.7}]` |
| `exists` | array of strings | Keys that must be present — `metadata ? key` |
| `roles` | array of strings | Restrict to these roles (narrows within scope, never widens) |
| `available` | `true`/`false` | `true` = unclaimed/expired only; `false` = held now |
| `jeopardy` | `1`/`true` | Only rows past their role's priority threshold — the exact predicate behind the Pace Board's priority count, so a jeopardy list's total equals the badge. Age from the role's `priority_facet` metadata timestamp (`created_at` when unset) against `priority_threshold_minutes` (`sla_minutes` when unset); undialed roles contribute no rows |
| `orderBy` | array of `{field, direction?, numeric?}` | Sort by column or `metadata.<key>` |

When any faceted parameter is present the request runs through the scoped faceted query.
Example (URL-encode the JSON values):

```
GET /api/escalations?status=pending&facets={"flags":"too_short"}&range=[{"facet":"confidence","op":"<=","value":0.7}]
```

See [Faceted Routing — the human / operations query](../../faceted-routing.md#the-human--operations-query).

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

**Response 200:** A single escalation object. The response embeds a `form_schema` field — the target role's versioned `form_schema` resolved to the escalation's pinned `metadata.schema_version` (or the role's latest when unpinned), JOINed from the roles tables in the same query and never stored on the escalation row. The dashboard renders the resolve form from this field; an MCP agent sees the same schema via `check_resolution`.

**Response 404:**

```json
{ "error": "Escalation not found" }
```

## Get escalation lookups

```
GET /api/escalations/:id/lookups
```

Resolves the versioned knowledge lookups pinned on the row (`envelope.lookups`). The refs ARE the grant: any user who may read the escalation may fetch exactly the pinned editions it names — the general knowledge API stays a builder surface. See [lookups](../../hitl/lookups.md).

**Scope:** Enforces the same read scope as `GET /api/escalations/:id`.

**Response 200:**

```json
{
  "lookups": [
    { "domain": "catalog", "key": "materials", "version": 2, "data": { "items": ["aluminum", "steel"] } },
    { "domain": "catalog", "key": "geo", "version": 9, "data": null, "missing": true }
  ]
}
```

A ref whose snapshot does not exist answers with `missing: true` — the batch never fails.

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

The `resolverPayload` is stored exactly as submitted — the resolver payload is the payload, with no server-side mapping of its shape. The client forms the final payload: the React dashboard maps the flat form to the nested payload via each field's `x-lt-bind` before submitting.

**Schema enforcement (roles with `enforce_schema`):** every resolve surface validates the submitted `resolverPayload` against the escalation's resolved form schema (`metadata.form_schema` override, else the pinned `lt_role_schemas` snapshot, else the role's latest) and rejects violations with **422** before any state changes. The body is the canonical validation shape, identical across HTTP, SDK, MCP, and CLI — see [Schema Enforcement](../../schema-enforcement.md):

```json
{
  "error": "resolverPayload failed schema validation (1 violation)",
  "code": "schema_validation",
  "violations": [{ "field": "contact_email", "message": "Enter a valid email address" }],
  "role": "intake-reviewer",
  "schemaVersion": 3
}
```

Bulk surfaces (`resolve-by-ids`, `resolve-all-or-none`) tag each violation with its `escalationId`, and one failing item blocks the batch before anything resolves.

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

When an escalation has `metadata.signal_id`, the resolve endpoint signals the running workflow instead of starting a new one. The workflow is still alive — it called `conditional(signalId)` and is paused.

The resolver payload is augmented with `$escalation_id` before signaling:

```json
{ "approved": true, "notes": "Looks good", "$escalation_id": "esc-a1b2c3d4-..." }
```

The workflow is responsible for resolving the escalation. The `conditional()` helper handles this automatically — it strips `$escalation_id`, calls `ltResolveEscalation` as a durable activity, and returns the clean payload.

If you use raw `Durable.workflow.condition()` instead, you must resolve the escalation yourself using the `$escalation_id` from the signal data.

### Signal-key resolution (efficient/atomic — `signal_key`)

When an escalation was written atomically by `conditional(signalId, config)` (or `Durable.workflow.condition(signalId, config)`), the row carries a `signal_key` and no `signal_id`/`signal_routing` metadata. The resolve endpoint detects `signal_key` and resolves it through the SDK: the resolve marks the row resolved **and** delivers the signal to the waiting `condition()` in one transaction, so the original job resumes in place — no re-run, no separate resolve activity. `system.escalation.{role}.{id}.resolved` fires.

```
POST /api/escalations/resolve-by-signal-key
```

For callers that know the deterministic signal id (webhooks — e.g. `signal-scan-ar-${orderId}`) and want to skip the id lookup.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signalKey` | `string` | yes | The signal id passed to `conditional(signalId, config)` |
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

### Option 1: Role `form_schema` (versioned)

The escalation form is owned by the target **role** as a versioned `form_schema`, declared on the role (e.g. via `PATCH /api/roles/:role`). Every escalation targeting that role resolves against it. A workflow pins a specific version through `conditional`'s `schemaVersion`, which stamps `metadata.schema_version` on the escalation; unpinned escalations resolve against the role's latest `form_schema`. Fields may carry `x-lt-bind` to map a form value to a path in the resolver payload.

The deprecated workflow-config `resolver_schema` remains only as a legacy fallback when no role `form_schema` is available.

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

The form that renders is resolved by precedence: `metadata.form_schema` (a legacy inline schema on the escalation row) > the role's `form_schema` (resolved to the escalation's pinned `metadata.schema_version`, or the role's latest when unpinned, and embedded in the `GET /api/escalations/:id` response) > the deprecated workflow-config `resolver_schema` legacy fallback.

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

## Station Metrics

```
GET /api/escalations/station-metrics
```

Per-role operational metrics for all visible stations. Returns queue depth, throughput efficiency, wait time (creation → claim) and work time (claim → resolution) at multiple percentiles. This drives the Operations pace chart and station detail panel.

RBAC: `superadmin` sees all stations; other roles see only stations for their assigned roles.

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `string` | `24h` | Lookback window for resolved/wait/work metrics. One of `15m`, `1h`, `24h`, `7d`, `30d` |

**Response 200:**

```json
{
  "stations": [
    {
      "role": "reviewer",
      "pending": 12,
      "claimed": 3,
      "resolved": 45,
      "priority_count": 2,
      "throughput_pct": 112.5,
      "wait": {
        "p99": 18.3,
        "p50": 4.1,
        "avg": 5.2,
        "max": 22.0
      },
      "work": {
        "p99": 28.7,
        "p50": 14.0,
        "avg": 15.3,
        "max": 35.1
      }
    }
  ]
}
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `role` | `string` | Role key |
| `pending` | `number` | Escalations currently pending (real-time) |
| `claimed` | `number` | Escalations actively claimed (real-time) |
| `resolved` | `number` | Escalations resolved within the selected period |
| `priority_count` | `number` | Pending, unclaimed escalations past the role's age threshold — the Pace Board rebalance signal |
| `throughput_pct` | `number \| null` | `resolved / (target_per_hour × period_hours) × 100`. `null` when the role has no `target_per_hour` set |
| `wait.p99` | `number \| null` | 99th-percentile wait time in minutes (creation → first claim) within the period. `null` when no resolved items |
| `wait.p50` | `number \| null` | Median wait time in minutes |
| `wait.avg` | `number \| null` | Mean wait time in minutes |
| `wait.max` | `number \| null` | Max wait time in minutes |
| `work.p99` | `number \| null` | 99th-percentile work time in minutes (claim → resolution) |
| `work.p50` | `number \| null` | Median work time |
| `work.avg` | `number \| null` | Mean work time |
| `work.max` | `number \| null` | Max work time |

**Notes:**
- `pending` and `claimed` reflect the live queue state, not the selected period.
- `throughput_pct` above 100 means the station resolved more than its target — ahead of schedule. Below 100 means behind.
- `priority_count` measures age from the role's `priority_facet` metadata timestamp (`created_at` when unset) against `priority_threshold_minutes` (`sla_minutes` when unset); it is 0 when neither threshold is configured. Claimed items are excluded. With a facet configured, items missing the key or holding an unparseable value are not counted.
- Time values are in decimal minutes.

**Example:** Fetch station metrics for the last hour:

```
GET /api/escalations/station-metrics?period=1h
```

## Get escalation stats

```
GET /api/escalations/stats
```

Aggregated escalation statistics. RBAC-scoped: superadmins see all; others see only their roles. The aggregate reflects `read_all` memberships only — a member's `read_scope=self` items are not aggregated here, since self-scope members get the single-item surface rather than a queue dashboard.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | `string` | Counting window for created/resolved. One of `1h`, `24h`, `7d`, `30d` (default `24h`; other values fall back to `24h`). Station metrics additionally support `15m` |

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

Assign multiple escalations to a specific user, by id-set or by query (exactly one). Superadmins can assign anyone. Admins can only assign to users who hold the escalation's role.

**Rows under a live claim are skipped** by a plain assign and counted in the response's `skipped` — assignment is claim-on-behalf, and an active claim wins. To take over live claims, pass `reassign: true` (ids form; admin/superadmin only): the takeover is one guarded statement, the displaced holder's in-flight resolve fails its claim assertion, and each taken row's `claimed` event carries `reassigned_from`.

The query form is one atomic statement: selection and claim happen in the same UPDATE, so a row that re-parks between a search and an ids-assign is still captured. Use it whenever the population is describable by role + facets.

**Request body:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ids` | `string[]` | | Escalation UUIDs to assign (ids form) |
| `query` | `object` | | `{ role, facets? }` selector (query form); `role` is required, `facets` filter by metadata containment |
| `targetUserId` | `string` | | User ID to assign the escalations to |
| `durationMinutes` | `integer` | 30 | How long each assignment lasts |
| `reassign` | `boolean` | false | Also take over rows under a live claim (ids form only; requires admin/superadmin) |

**Example request (ids form):**

```json
{ "ids": ["esc-a1b2c3d4-..."], "targetUserId": "user-x1y2z3", "durationMinutes": 60 }
```

**Example request (query form):**

```json
{ "query": { "role": "order-items", "facets": { "orderId": "ORD-1042" } }, "targetUserId": "user-x1y2z3", "durationMinutes": 60 }
```

**Response 200:** Result object with assignment outcomes.

**Response 400:**

```json
{ "error": "targetUserId is required" }
```

```json
{ "error": "Target user does not hold the \"reviewer\" role" }
```

## Bulk unassign

```
POST /api/escalations/bulk-unassign
```

Return claimed escalations to the available pool — the admin override of someone else's live claim (a holder returning their own item uses release). One guarded statement: unclaimed and terminal rows are skipped, and each returned row publishes a `released` event carrying `released_by` (the acting admin) and `unassigned_from` (the displaced holder).

**RBAC:** admin or superadmin (global escalation access).

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `ids` | `string[]` | Escalation UUIDs to return to the pool |

**Response 200:**

```json
{ "unassigned": 2, "skipped": 1 }
```

`skipped` counts rows that were unclaimed or terminal at call time.

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

Resolve multiple escalations and start AI triage workflows (mcpTriage) for each. Rows backing a live `condition()` waiter (`signal_key` set) stay `pending` and are excluded from `triaged` — settle those individually via `POST /:id/resolve`, which carries the workflow's wake. Requires admin or superadmin permission for the escalation roles.

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

Permanently cancels a pending or claimed escalation. The workflow waiting on this escalation (via `conditional`) receives `null` as the condition result, allowing it to handle the cancellation gracefully.

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

**Request body (optional):**

| Field | Type | Description |
|-------|------|-------------|
| `quiet` | boolean | Perform the identical release without publishing the `released` event. For bookkeeping releases — a dispatcher's held-skip loop freeing rows every ranking window — that are not lifecycle transitions. Faceted machine claims are already silent; this is the release-side counterpart. Default: `false` (loud). |

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
| `status` | `string` | `pending`, `resolved`, `cancelled`, or `expired` |
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

These endpoints find, claim, and resolve escalations using a business-domain key stored in the `metadata` JSONB column (e.g., `orderId`). Lookups go straight through the GIN index on `metadata`, so they stay fast at any scale.

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
| `status` | `string` | Filter by status (`pending`, `resolved`, `cancelled`, `expired`) |
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

**Signal guard:** If the escalation has `metadata.signal_id` (created by `conditional`), the SQL does NOT resolve it directly. Instead, the endpoint signals the running workflow — `conditional` receives the signal and resolves the escalation durably inside the workflow. This preserves the same transactional integrity as the standard resolve-by-ID path.

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

**Response 200 (signal-backed):** Workflow signaled; `conditional` resolves the escalation durably.

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

Resolve many escalations in one guarded statement — the set-based sibling of `POST /:id/resolve`. Used for bookkeeping rows that are woken collectively (it does not deliver a per-row signal). The store enforces this: rows backing a live `condition()` waiter (`signal_key` set) stay `pending` and are excluded from the response — settle those via `POST /:id/resolve`, which carries the wake. RBAC: a scoped caller may only resolve rows whose role they hold (global principals are unrestricted).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | yes | Escalation ids to resolve as one set |
| `resolverPayload` | `object` | yes | Payload applied to every row |
| `metadata` | `object` | no | Outcome patch merged into each row's GIN-indexed metadata |

**Response 200:** `{ "resolved": <count>, "escalationIds": [...] }` — only still-`pending` rows without a `signal_key` are resolved and returned.

## Resolve a set atomically (all-or-none)

```
POST /api/escalations/resolve-all-or-none
```

Atomic bulk resolve with per-row payloads: every listed escalation resolves with its own `resolverPayload` in one SQL statement, or nothing resolves. Rows backing a live `condition()` waiter are first-class — each waiter's wake commits with its resolve, delivering that row's payload as the condition's return value (the same wake contract as `POST /:id/resolve`). For gang handoffs where each member needs a distinct mandate and a partial batch is unacceptable: the caller gets a clean binary — all mandates delivered, or the set intact for a retry.

RBAC matches `resolve-by-ids`: per-item write scope; any missing or out-of-scope id returns 404 with nothing resolved. Rows that resolve through legacy signal routing (`metadata.signal_id` / `metadata.signal_routing`) require `POST /:id/resolve` and block the batch with reason `unsupported-resolution-path`. Password-format fields are redacted per row against that row's own `form_schema`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | `Array<{ id, resolverPayload }>` | yes | The batch — each row resolves with its own payload. Ids must be unique; max 100 items (`LT_ESCALATION_BULK_RESOLVE_MAX`) |
| `metadata` | `object` | no | Shared outcome patch merged into every row's GIN-indexed metadata |
| `requireClaimed` | `boolean` | no | Assert every row is currently assigned to the caller, inside the atomic statement — closes the re-claim race for claim-then-resolve flows |

**Response 200:** `{ "resolved": <count>, "escalationIds": [...] }` — every listed row resolved.

**Response 409:** `{ "error": ..., "failedIds": [...], "failed": [{ "id": ..., "reason": ... }] }` — nothing resolved. Only the rows that blocked the batch are listed (`not-found`, `already-resolved`, `already-cancelled`, `already-expired`, `assignee-mismatch`, `unsupported-resolution-path`); resolvable members stay pending, untouched.

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

## Aggregate by facets

```
POST /api/escalations/aggregate-by-facets
```

Grouped analytics over the escalation intervals. Every escalation is one open interval `[created_at, ended_at)` — `ended_at` is the instant the row left the live set (resolved / cancelled / expired), `NULL` while live. The aggregate reads that time-series two ways: **membership** (rows — or, with `distinctBy`, distinct entities — whose interval is open at an instant; a past `asOf` reconstructs the live set at that moment) and **dwell** (open-seconds per group within a half-open `[from, to)` window, clipped to it on both ends). One call replaces N per-filter count round-trips. See [escalation-analytics.md](../../escalation-analytics.md) for the full guide.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `object` | yes | The filter — `role`/`roles` (or `entity`), `facets`, `anyOf` (rows carrying ANY of the given facet sets, max 200 — target an explicit entity set such as one table page), `block`, `range`, `exists`, and `prefix` (case-insensitive prefix match on facet values — the locate affordance, e.g. `{"serialNumber":"PRN-00"}`). `entity` names an entity facet key and resolves server-side to every role declaring it as its `entity_facet` — the entity's **system**; mutually exclusive with `role`/`roles`, and it implies `exists: [entity]` so stray rows without the key stay out |
| `groupBy` | `object` | yes | Group keys — `columns` (whitelisted: `role`, `subtype`, `status`), `facets` (metadata keys, projected as text; `NULL` group key when absent), and `state` (group by the derived state label: each role contributes per its `entity_state_source` — its subtypes or itself; mutually exclusive with `states[]`). An empty object yields one total row |
| `measure` | `object` | yes | Exactly one kind: `{ "kind": "membership", "asOf"? }` (default anchor: now) or `{ "kind": "dwell", "window": { "from", "to" } }` |
| `distinctBy` | `string` | no | Membership only — count DISTINCT of this metadata facet per group (entities, not rows). Omit to count rows |
| `states` | `array` | no | Pure labeling: tag each group with the FIRST matching `{ name, match }` entry, evaluated top-to-bottom; `match` compares grouped columns/facets. Grouping is unchanged |
| `liveStatuses` | `string[]` | no | Statuses considered live (default `["pending"]`) |
| `orderBy` | `array` | no | Order the RESULT groups: `{ field, direction? }` — `count`, `dwellSeconds`, `sampleCount`, a grouped column, or a grouped facet key |
| `limit` / `offset` | `integer` | no | Result-group paging, capped at `LT_ANALYTICS_MAX_GROUPS` |

The filter takes the WHAT fields only. `status`, `available`, and `jeopardy` are rejected — liveness derives from the interval, `liveStatuses`, and the measure anchor. Query-level `orderBy`/`limit`/`offset` are rejected too — order and paginate the result groups with the top-level fields.

**Example** — how the printer fleet spent a day, one row per state. The three seeded roles declare `entity_facet: "serialNumber"`: `printer-fleet` uses `entity_state_source: "subtype"` (its `idle` / `printing` subtypes are states), while `printer-harvest` and `printer-service` use `"role"` (each role is a state):

```json
{
  "query": { "entity": "serialNumber" },
  "groupBy": { "state": true },
  "measure": {
    "kind": "dwell",
    "window": { "from": "2026-08-01T00:00:00Z", "to": "2026-08-02T00:00:00Z" }
  }
}
```

**Response 200:**

```json
{
  "groups": [
    { "facets": {}, "state": "printing", "dwellSeconds": 214380, "sampleCount": 41 },
    { "facets": {}, "state": "idle", "dwellSeconds": 132600, "sampleCount": 38 },
    { "facets": {}, "state": "printer-harvest", "dwellSeconds": 21540, "sampleCount": 17 },
    { "facets": {}, "state": "printer-service", "dwellSeconds": 9060, "sampleCount": 3 }
  ],
  "overflow": false
}
```

Adding `"facets": ["model"]` to `groupBy` slices the same bands per model value (`p1s` vs `h2s`).

**Response fields (per group):**

| Field | Type | Description |
|-------|------|-------------|
| `role` / `subtype` / `status` | `string` | Present iff requested in `groupBy.columns`. `status` is the row's status NOW — status history is not stored, so a past `asOf` still groups by current status |
| `facets` | `object` | One entry per `groupBy.facets` key; `null` when the facet is absent on the underlying rows |
| `state` | `string` | Present when `groupBy.state` derived it or a `states[]` entry matched |
| `count` | `number` | Membership: entities (with `distinctBy`) or rows (without) |
| `dwellSeconds` | `number` | Dwell: summed open-seconds within the window |
| `sampleCount` | `number` | Underlying escalation rows contributing to the group (pre-distinct) |

`overflow: true` means the group cap was hit — more groups exist beyond this page.

**Response 400** — a caller-input problem: a liveness field (`status`/`available`/`jeopardy`) or `orderBy`/`limit`/`offset` on the filter; `entity` together with `role`/`roles`; `groupBy.state` together with `states[]`; an unknown status in `liveStatuses`; an empty window or one wider than `LT_ANALYTICS_MAX_WINDOW_DAYS`; a future `asOf`; a malformed facet key; a `states[]` match referencing a key the query never groups by.

**Response 403** — the caller must hold `read_all` on every role in scope (for `entity`, every role in the derived system); a filter with no role scope spans every pond and requires a global principal (superadmin/admin). While `features.publicPaceBoard` stands (default on), counts-only groupings — no `groupBy.facets` keys — are readable by any login, the same data class the Pace Board exposes; a facet-keyed grouping emits facet values (entity ids) as group keys and always takes the full gate.

## Timeline by facet

```
POST /api/escalations/timeline-by-facet
```

One entity's ordered interval sequence — every escalation the entity facet appeared in, as `[startedAt, endedAt)` spans with durations, in `created_at` order. Open intervals report `endedAt: null`. Gaps between consecutive intervals are untracked time and are preserved, not filled. The facet is matched GIN-served (`metadata @> {key: value}`), so the stored value must be a JSON string.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `facet` | `{ key, value }` | yes | The entity facet to trace |
| `query` | `object` | no | Optional extra filter / role scope (or `entity` — the derived system). Same field rules as the aggregate filter |
| `window` | `{ from, to }` | no | Only intervals overlapping the window (overlap-filtered, not clipped) |
| `select` | `object` | no | `columns` / `facets` to surface per interval (default: all three columns) |
| `liveStatuses` | `string[]` | no | Statuses considered live (default `["pending"]`) |
| `order` | `string` | no | Interval ordering by start instant — `asc` (default) or `desc`; `desc` + `before` pages a long history recent-first |
| `before` | `string` | no | Strict upper bound on `startedAt` (ISO instant) — the "load earlier" cursor |
| `limit` | `integer` | no | Max intervals |

**Example** — one printer's movement across the fleet's queues:

```json
{
  "facet": { "key": "serialNumber", "value": "PRN-001" },
  "query": { "entity": "serialNumber" }
}
```

**Response 200:**

```json
{
  "intervals": [
    {
      "role": "printer-fleet",
      "subtype": "printing",
      "status": "resolved",
      "facets": {},
      "startedAt": "2026-08-01T08:00:00.000Z",
      "endedAt": "2026-08-01T09:30:00.000Z",
      "durationSeconds": 5400
    },
    {
      "role": "printer-harvest",
      "subtype": "harvest",
      "status": "pending",
      "facets": {},
      "startedAt": "2026-08-01T09:30:00.000Z",
      "endedAt": null,
      "durationSeconds": 1800
    }
  ],
  "overflow": false
}
```

`durationSeconds` runs to `endedAt`, else to `window.to` clamped at now. `overflow: true` means the interval cap was hit.

**Response 400** — same validation class as the aggregate: a rejected filter field, an invalid window, a malformed facet key.

**Response 403** — timelines always take the full gate: an entity's movement history is item-level disclosure. The caller must hold `read_all` on every role in scope (for `entity`, every role in the derived system); a roleless query requires a global principal.
