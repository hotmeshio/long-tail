# Roles API

Roles connect workflows to people. When a workflow escalates, the escalation targets a role. Users assigned that role see the escalation in their queue. Roles are implicit — they exist the moment you reference them. There is no separate "create role" step.

Role management endpoints are nested under `/api/users/:id/roles`. All endpoints require authentication.

## Role Types

Every role assignment has a `type` that controls management permissions.

| Type | Permissions |
|------|-------------|
| `member` | Work the role's task queue at the breadth set by its work-surface scope (see below) |
| `admin` | Everything a member can do on the whole queue, plus manage users within this role |
| `superadmin` | Full access — manage all roles, all users, system configuration |

A user can hold multiple roles with different types. For example, a user might be a `member` of `reviewer` and an `admin` of `senior-reviewer`.

## Work-Surface Scope

A role is a task queue with four verbs — **search**, **claim**, **ack** (resolve), **delete** (cancel). A `member` carries two orthogonal scope axes that set the breadth of those verbs. `admin` and `superadmin` ignore scope and always act on the whole queue.

| Axis | Values | Governs |
|------|--------|---------|
| `read_scope` | `self`, `all` | **search** — which escalations the member sees |
| `write_scope` | `none`, `self`, `all` | **claim / ack / delete** — which escalations the member may act on |

`self` means escalations assigned to the member (`assigned_to = user`); `all` means the whole role queue. The only constraint is **write ⊆ read** — you cannot act on what you cannot see — so `write_scope=all` requires `read_scope=all`. Both default to `all`, which is the full-queue worker.

The five member profiles:

| read_scope | write_scope | Profile |
|-----------|------------|---------|
| `all` | `all` | Full worker — search and act on the whole queue (default) |
| `all` | `self` | See the whole queue, act only on own items (e.g. a chat-style room) |
| `self` | `self` | Own items only — a one-time user filling in their pre-assigned form |
| `all` | `none` | Read-only observer / auditor of the queue |
| `self` | `none` | Read-only view of one's own items |

Releasing and escalating are queue-management verbs (they move an item out of the member's hands) and require `write_scope=all`; creating a standalone escalation likewise requires `write_scope=all`. A member with `write_scope=self` may only claim/ack/delete items already assigned to them.

This makes one-time and limited-surface users first-class: a workflow can assign an escalation to a named person (pre-claim) and provision them as `read_self` + `write_self`, and they see and act on exactly that one item — no access to the rest of the queue, no table, just the JIT form the workflow routed to them.

## Special Roles

Three role names have fixed types and elevated permissions:

| Role | Fixed Type | Dashboard | Escalation Scope | User Management |
|------|-----------|-----------|-------------------|-----------------|
| `superadmin` | `superadmin` | Full (builder + admin) | All roles — role filter ignored | Create other superadmins. Manage any user, any role |
| `engineer` | `admin` | Full (builder) | Engineer role only | Assign users to `engineer` role |
| `admin` | `admin` | Escalations + user management | All roles — role filter ignored | Assign users to any non-special role. Bulk actions on all escalations |

All other role names are dynamic. A dynamic role can have type `member` (work the queue at its read/write scope) or `admin` (whole-queue access plus manage users within that role and bulk actions).

## Dashboard Access

The dashboard adapts to the authenticated user's access tier:

| Tier | Condition | Sees |
|------|-----------|------|
| **Builder** | `superadmin` or `engineer` role | Full dashboard: workflows, pipelines, MCP, design, storage, admin, all home page sections |
| **Operations** | Any role with `admin` type | Home page (escalations only), escalation pages, user/role management (scoped to their roles) |
| **Operator** | Any role with `member` type | Home page (escalations only), escalation pages — scoped to the member's read scope |

Bulk escalation actions (bulk claim, assign, triage, escalate) require `admin` or `superadmin` type. Plain `member` users work on escalations one at a time. A member whose read scope is `self` lands directly on their own item in user mode — the queue list and aggregate stats reflect only `read_all` memberships.

## API Access by Tier

Certain API endpoints require builder access (`superadmin` or `engineer` role):

| Endpoint | Access |
|----------|--------|
| `POST/PUT/DELETE /api/users` | Builder |
| `POST /api/users/:id/roles` | Admin (scoped — see below) |
| All `/api/bot-accounts` | Builder |
| All `/api/roles` mutations | Builder |
| All `/api/controlplane` | Builder |

### Scoped Role Assignment

When assigning roles via `POST /api/users/:id/roles`, the caller's own roles determine what they can assign:

| Caller | Can Assign |
|--------|-----------|
| `superadmin` | Any role, any type (including `superadmin/superadmin`) |
| `engineer` | Any role up to `admin` type (never `superadmin` type) |
| `*/admin` (non-builder) | `member` or `admin` type for roles they themselves hold |

A caller who may assign a role may set any work-surface scope (`read_scope`/`write_scope`) on it. Scope is a refinement of a `member` grant; it is ignored for `admin`/`superadmin`, which always act on the whole queue.

## List roles for a user

```
GET /api/users/:id/roles
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | User UUID |

**Response 200:**

```json
{
  "roles": [
    {
      "user_id": "b2c3d4e5-...",
      "role": "reviewer",
      "type": "member",
      "created_at": "2025-01-10T08:00:00.000Z"
    },
    {
      "user_id": "b2c3d4e5-...",
      "role": "senior-reviewer",
      "type": "admin",
      "created_at": "2025-01-10T08:00:00.000Z"
    }
  ]
}
```

## Add role to user

```
POST /api/users/:id/roles
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | User UUID |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | yes | Role name (e.g., `reviewer`) |
| `type` | `string` | yes | `superadmin`, `admin`, or `member` |
| `read_scope` | `string` | no | `self` or `all` (default `all`). Search breadth for a `member`; ignored for admin/superadmin |
| `write_scope` | `string` | no | `none`, `self`, or `all` (default `all`). Claim/ack/delete breadth for a `member` |

**Example request** — a one-time user who works only their own assigned item:

```json
{ "role": "customer-triage", "type": "member", "read_scope": "self", "write_scope": "self" }
```

**Response 201:**

```json
{
  "user_id": "b2c3d4e5-...",
  "role": "customer-triage",
  "type": "member",
  "read_scope": "self",
  "write_scope": "self",
  "created_at": "2025-01-15T12:00:00.000Z"
}
```

**Response 400:**

```json
{ "error": "role and type are required" }
```

```json
{ "error": "type must be superadmin, admin, or member" }
```

```json
{ "error": "write_scope=all requires read_scope=all (cannot act on what you cannot see)" }
```

A user can hold each role at most once. The primary key is `(user_id, role)`. Adding a role that already exists will return an error.

## Remove role from user

```
DELETE /api/users/:id/roles/:role
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | User UUID |
| `role` | Role name to remove |

**Response 200:**

```json
{ "removed": true }
```

**Response 404:**

```json
{ "error": "Role not found" }
```

---

## Role Management

These endpoints manage roles as standalone entities and are nested under `/api/roles`. All endpoints require authentication.

### List all roles

```
GET /api/roles
```

Returns all distinct role names known to the system.

**Response 200:**

```json
{
  "roles": ["reviewer", "senior-reviewer", "admin"]
}
```

### List roles with details

```
GET /api/roles/details
```

Returns all roles with metadata and usage counts.

**Response 200:**

```json
{
  "roles": [
    {
      "role": "reviewer",
      "title": "Document Reviewer",
      "description": "Reviews flagged documents for compliance",
      "form_schema": null,
      "metadata_schema": null,
      "properties": {},
      "ops_visible": true,
      "parent_role": null,
      "sla_minutes": 30,
      "target_per_hour": 20,
      "worker_count": 4,
      "user_count": 5,
      "chain_count": 2,
      "workflow_count": 3
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string \| null` | Display name separate from the technical role key |
| `description` | `string \| null` | Human-readable summary |
| `form_schema` | `object \| null` | JSON Schema for the escalation resolve form (overridden per-workflow by `resolver_schema`) |
| `metadata_schema` | `object \| null` | JSON Schema declaring the expected shape of `lt_escalations.metadata` for this role. Drives faceted-query key autocomplete and creation-time validation |
| `properties` | `object` | Free user-owned bag — icons, colors, tags, etc. No reserved keys |
| `ops_visible` | `boolean` | When `true`, the role appears as a station on the `/operations` view |
| `parent_role` | `string \| null` | Parent role in the process dependency graph; `null` for root stations |
| `sla_minutes` | `number \| null` | Target resolution time in minutes (capacity setting) |
| `target_per_hour` | `number \| null` | Intended throughput — items resolved per hour (capacity setting) |
| `worker_count` | `number \| null` | Capacity at this station — staff or machine count (capacity setting) |
| `user_count` | `number` | Number of users assigned this role |
| `chain_count` | `number` | Number of escalation chain entries referencing this role |
| `workflow_count` | `number` | Number of workflow configs that reference this role |

### Create a role

```
POST /api/roles
```

Create a standalone role. Requires admin.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | yes | Role name (lowercase letters, numbers, hyphens, underscores; must start with a letter) |

**Example request:**

```json
{ "role": "senior-reviewer" }
```

**Response 201:**

```json
{ "role": "senior-reviewer" }
```

**Response 400:**

```json
{ "error": "role is required" }
```

```json
{ "error": "Role must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores" }
```

### Delete a role

```
DELETE /api/roles/:role
```

Delete a role if it has no references. Requires admin.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `role` | Role name to delete |

**Response 200:**

```json
{ "deleted": true }
```

**Response 409:**

```json
{ "error": "Cannot delete role" }
```

### Update a role

```
PATCH /api/roles/:role
```

Update role metadata. Only provided fields are changed; omitted fields remain unchanged. `form_schema`, `metadata_schema`, and `parent_role` can be explicitly set to `null` to clear them. Requires role manager (admin type, superadmin, or engineer).

When the update changes `form_schema` or `metadata_schema`, the new pair is snapshotted into the role's schema version history and `current_schema_version` advances (a save with identical schema values leaves the version alone). Pass `change_summary` to label the snapshot.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `role` | Role key to update |

**Request body** (all fields optional):

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string \| null` | Display name |
| `description` | `string \| null` | Short description |
| `form_schema` | `object \| null` | JSON Schema for the resolve form |
| `metadata_schema` | `object \| null` | JSON Schema for `lt_escalations.metadata` |
| `properties` | `object \| null` | Free user-owned bag |
| `ops_visible` | `boolean` | Include in the `/operations` view |
| `parent_role` | `string \| null` | Parent in the process dependency graph |
| `sla_minutes` | `number \| null` | SLA target in minutes |
| `target_per_hour` | `number \| null` | Throughput target (items per hour) |
| `worker_count` | `number \| null` | Station capacity |
| `upstream_roles` | `string[] \| null` | Replace the set of roles this station draws input from across other Operations sequences (omitted = preserve; `null` or `[]` = clear). Every entry must name an existing role other than this one. Distinct from `parent_role`, which places the role in its own sequence. |
| `change_summary` | `string` | Label recorded on the schema version snapshot when this update changes a schema field |

**Example request** — configure a role as a station in the ops view:

```json
{
  "title": "Document Reviewer",
  "ops_visible": true,
  "sla_minutes": 30,
  "target_per_hour": 20,
  "worker_count": 4
}
```

**Response 200:** Updated `RoleDetail` object (same shape as `GET /api/roles/details`).

**Response 404:**

```json
{ "error": "Role 'unknown-role' not found" }
```

### Get a role's schema

```
GET /api/roles/:role/schema
GET /api/roles/:role/schema?version=3
```

Fetch the role's `form_schema` + `metadata_schema` pair. Without `version`, returns the live (latest) schema along with the role's current version number. With `version`, returns that immutable snapshot from the version history — the snapshot an escalation pinned via `metadata.schema_version` (`conditionLT`'s `schemaVersion` field).

**Response 200:**

```json
{
  "role": "reviewer",
  "version": 3,
  "form_schema": { "type": "object", "properties": { "approved": { "type": "boolean" } } },
  "metadata_schema": { "type": "object", "properties": { "order_id": { "type": "string" } } },
  "change_summary": "Added lotNumber field",
  "created_at": "2026-07-01T12:00:00.000Z",
  "latest_version": 4
}
```

**Response 404:** the role does not exist, or the requested version does not exist for it. A missing version is an error — it never falls back to a different version.

### List a role's schema versions

```
GET /api/roles/:role/schema/versions
```

List the role's schema version history, newest first. Schemas are elided; each entry carries presence flags. Fetch a full snapshot via `GET /api/roles/:role/schema?version=N`.

**Response 200:**

```json
{
  "versions": [
    {
      "version": 4,
      "has_form_schema": true,
      "has_metadata_schema": true,
      "change_summary": null,
      "created_at": "2026-07-02T09:30:00.000Z",
      "is_current": true
    },
    {
      "version": 3,
      "has_form_schema": true,
      "has_metadata_schema": true,
      "change_summary": "Added lotNumber field",
      "created_at": "2026-07-01T12:00:00.000Z",
      "is_current": false
    }
  ]
}
```

---

## Escalation Chains

Escalation chains define which roles can escalate to which other roles. Managed under `/api/roles/escalation-chains`.

### List all escalation chains

```
GET /api/roles/escalation-chains
```

Returns all escalation chain pairs.

**Response 200:**

```json
{
  "chains": [
    { "source_role": "reviewer", "target_role": "senior-reviewer" }
  ]
}
```

### Add an escalation chain

```
POST /api/roles/escalation-chains
```

Add a single escalation chain entry. Requires admin.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_role` | `string` | yes | Role that can escalate |
| `target_role` | `string` | yes | Role to escalate to |

**Example request:**

```json
{ "source_role": "reviewer", "target_role": "senior-reviewer" }
```

**Response 201:**

```json
{ "source_role": "reviewer", "target_role": "senior-reviewer" }
```

**Response 400:**

```json
{ "error": "source_role and target_role are required" }
```

### Remove an escalation chain

```
DELETE /api/roles/escalation-chains
```

Remove a single escalation chain entry. Requires admin.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source_role` | `string` | yes | Source role |
| `target_role` | `string` | yes | Target role |

**Response 200:**

```json
{ "removed": true }
```

**Response 404:**

```json
{ "error": "Chain entry not found" }
```

### Get escalation targets for a role

```
GET /api/roles/:role/escalation-targets
```

Returns the allowed escalation targets for a specific role.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `role` | Role name |

**Response 200:**

```json
{
  "targets": ["senior-reviewer", "manager"]
}
```

### Replace escalation targets for a role

```
PUT /api/roles/:role/escalation-targets
```

Replace all escalation targets for a role. Requires admin.

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `role` | Role name |

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `targets` | `string[]` | yes | New list of target roles |

**Example request:**

```json
{ "targets": ["senior-reviewer", "manager"] }
```

**Response 200:**

```json
{ "role": "reviewer", "targets": ["senior-reviewer", "manager"] }
```

**Response 400:**

```json
{ "error": "targets must be an array of strings" }
```

---

## Roles in Workflow Configuration

Roles also appear in workflow configuration. When you register a workflow, `default_role` sets the escalation target and `roles` lists every role allowed to claim escalations:

```
PUT /api/workflows/reviewContent/config

{
  "is_lt": true,
  "default_role": "reviewer",
  "roles": ["reviewer", "senior-reviewer"]
}
```

When `reviewContent` escalates, the escalation targets `reviewer` by default. Users with either `reviewer` or `senior-reviewer` can claim it.

See [Workflows API](workflows.md) for full configuration details.
