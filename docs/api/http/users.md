# Users API

Users represent the humans who claim and resolve escalations. Each user has a unique `external_id` that maps to your application's identity system. All endpoints require authentication. Mutating endpoints (create, update, delete, role management) require admin access (`admin` or `superadmin` role).

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
        { "user_id": "b2c3d4e5-...", "role": "reviewer", "type": "member", "read_scope": "all", "write_scope": "all", "created_at": "2025-01-10T08:00:00.000Z" },
        { "user_id": "b2c3d4e5-...", "role": "senior-reviewer", "type": "admin", "read_scope": "all", "write_scope": "all", "created_at": "2025-01-10T08:00:00.000Z" }
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
| `read_scope` | `string` | no | `self` or `all` (default `all`). Search breadth for a `member`; ignored for admin/superadmin |
| `write_scope` | `string` | no | `none`, `self`, or `all` (default `all`). Claim/ack/delete breadth for a `member` |

`read_scope` and `write_scope` set the work-surface scope of a `member` grant — how much of the role's queue the user can see and act on. Both default to `all` (the full-queue worker), so a `member` written without scope works the whole queue. The constraint is **write ⊆ read**: `write_scope=all` requires `read_scope=all`. See the [Work-Surface Scope](roles.md#work-surface-scope) section of the Roles API for the five member profiles.

**Example request:**

```json
{
  "external_id": "new-user",
  "email": "new-user@example.com",
  "display_name": "New User",
  "roles": [
    { "role": "reviewer", "type": "member" },
    { "role": "customer-triage", "type": "member", "read_scope": "self", "write_scope": "self" },
    { "role": "senior-reviewer", "type": "admin" }
  ]
}
```

**Response 201:** The created user object with roles array. Each returned role object includes its `read_scope` and `write_scope`.

**Response 400:**

```json
{ "error": "external_id is required" }
```

```json
{ "error": "Each role must have a role name and type (superadmin, admin, member)" }
```

```json
{ "error": "write_scope=all requires read_scope=all" }
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

---

## Self-Service — `/api/me`

Operations on the **authenticated caller** — no ids, no admin gates. Any signed-in user (or service account) may call them.

### GET /api/me/preferences

The caller's preferences document — a generic per-user JSON store for presentation state (pinned views are the first tenant). Reads `{}` when unset.

**Response 200:**

```json
{
  "preferences": {
    "pinnedViews": [
      { "id": "pin-x1", "label": "Needs harvesting", "url": "/escalations/available?role=fleet-servicer&jeopardy=1&view=table", "badge": true }
    ],
    "hiddenRolePins": ["My machines"]
  }
}
```

### PATCH /api/me/preferences

Shallow-merge the body into the caller's preferences: top-level keys overwrite whole, a `null` value deletes its key. The merge is a single guarded statement (no read-then-write) and the stored document is size-capped (~32 KB). Preferences carry presentation state only — URLs and UI choices, never data and never authorization.

**Request body** — any JSON object of preference keys:

```json
{ "pinnedViews": [ { "id": "pin-x1", "label": "Needs harvesting", "url": "/escalations/available?role=fleet-servicer&jeopardy=1", "badge": true } ], "theme": null }
```

**Response 200:** the merged document, `{ "preferences": { ... } }`.

**Response 400:** body is not a JSON object. **Response 413:** the patch or the merged document would exceed the size cap (nothing is written).

See the [Pinned Views guide](../../hitl/pinned-views.md) for how the dashboard uses this store.
