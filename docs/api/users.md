# Users API

Users represent the humans who claim and resolve escalations. Each user has a unique `external_id` that maps to your application's identity system. All endpoints require authentication.

For service identities (CI bots, schedulers, automated agents), use the [Service Accounts API](service-accounts.md) instead. Service accounts share the same RBAC system but authenticate with API keys rather than passwords or OAuth.

## List users

```
GET /api/users
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `role` | `string` | Filter by role name (e.g., `reviewer`) |
| `roleType` | `string` | Filter by role type: `superadmin`, `admin`, or `member` |
| `status` | `string` | Filter by status: `active`, `inactive`, or `suspended` |
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Example request:**

```
GET /api/users?role=reviewer&status=active&limit=10
```

**Response 200:**

```json
{
  "users": [
    {
      "id": "b2c3d4e5-...",
      "external_id": "jane",
      "email": "jane@acme.com",
      "display_name": "Jane Chen",
      "status": "active",
      "metadata": null,
      "created_at": "2025-01-10T08:00:00.000Z",
      "updated_at": "2025-01-10T08:00:00.000Z",
      "roles": [
        { "user_id": "b2c3d4e5-...", "role": "reviewer", "type": "member", "created_at": "2025-01-10T08:00:00.000Z" },
        { "user_id": "b2c3d4e5-...", "role": "senior-reviewer", "type": "admin", "created_at": "2025-01-10T08:00:00.000Z" }
      ]
    }
  ],
  "total": 1
}
```

## Get user details

```
GET /api/users/:id
```

**Path parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | User UUID |

**Response 200:** A single user object with roles array.

**Response 404:**

```json
{ "error": "User not found" }
```

## Create user

```
POST /api/users
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `external_id` | `string` | yes | Your application's identifier for this user |
| `email` | `string` | no | Email address |
| `display_name` | `string` | no | Display name |
| `roles` | `array` | no | Initial role assignments (see below) |
| `metadata` | `object` | no | Arbitrary metadata |

Each element in `roles`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | yes | Role name |
| `type` | `string` | yes | `superadmin`, `admin`, or `member` |

**Example request:**

```json
{
  "external_id": "jane",
  "email": "jane@acme.com",
  "display_name": "Jane Chen",
  "roles": [
    { "role": "reviewer", "type": "member" },
    { "role": "senior-reviewer", "type": "admin" }
  ]
}
```

**Response 201:** The created user object with roles array.

**Response 400:**

```json
{ "error": "external_id is required" }
```

```json
{ "error": "Each role must have a role name and type (superadmin, admin, member)" }
```

**Response 409:**

```json
{ "error": "User with this external_id already exists" }
```

## Update user

```
PUT /api/users/:id
```

Partial update — only the fields you include are changed.

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `email` | `string` | New email address |
| `display_name` | `string` | New display name |
| `status` | `string` | `active`, `inactive`, or `suspended` |
| `metadata` | `object` | Replacement metadata |

**Example request:**

```json
{
  "status": "suspended",
  "metadata": { "suspension_reason": "pending investigation" }
}
```

**Response 200:** The updated user object.

**Response 404:**

```json
{ "error": "User not found" }
```

## Delete user

```
DELETE /api/users/:id
```

Deletes the user and all associated role assignments (cascade).

**Response 200:**

```json
{ "deleted": true }
```

**Response 404:**

```json
{ "error": "User not found" }
```
