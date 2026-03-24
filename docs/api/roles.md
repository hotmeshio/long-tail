# Roles API

Roles connect workflows to people. When a workflow escalates, the escalation targets a role. Users assigned that role see the escalation in their queue. Roles are implicit — they exist the moment you reference them. There is no separate "create role" step.

Role management endpoints are nested under `/api/users/:id/roles`. All endpoints require authentication.

## Role Types

Every role assignment has a `type` that controls management permissions. All three types can claim and resolve escalations for their role.

| Type | Permissions |
|------|-------------|
| `member` | Claim and resolve escalations for this role |
| `admin` | Everything a member can do, plus manage users within this role |
| `superadmin` | Full access — manage all roles, all users, system configuration |

A user can hold multiple roles with different types. For example, a user might be a `member` of `reviewer` and an `admin` of `senior-reviewer`.

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

**Example request:**

```json
{ "role": "reviewer", "type": "member" }
```

**Response 201:**

```json
{
  "user_id": "b2c3d4e5-...",
  "role": "reviewer",
  "type": "member",
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

Returns all roles with usage counts.

**Response 200:**

```json
{
  "roles": [
    { "role": "reviewer", "user_count": 5 },
    { "role": "senior-reviewer", "user_count": 2 }
  ]
}
```

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
