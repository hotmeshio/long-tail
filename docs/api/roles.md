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
