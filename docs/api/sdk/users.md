# lt.users

Manage user accounts and their role assignments.

## list

List users with optional filters.

```typescript
const result = await lt.users.list({
  role: 'reviewer',
  roleType: 'admin',
  limit: 50,
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `role` | `string` | No | Filter by role name |
| `roleType` | `string` | No | Filter by role type (`superadmin`, `admin`, `member`) |
| `status` | `string` | No | Filter by user status |
| `limit` | `number` | No | Max results |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<User[]>`

**Auth:** Not required

---

## get

Retrieve a single user by ID.

```typescript
const result = await lt.users.get({ id: 'user_123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | User UUID |

**Returns:** `LTApiResult<User>` -- returns 404 if not found.

**Auth:** Not required

---

## create

Create a new user.

```typescript
const result = await lt.users.create({
  external_id: 'jane.doe',
  email: 'jane@example.com',
  display_name: 'Jane Doe',
  roles: [{ role: 'reviewer', type: 'member' }],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `external_id` | `string` | Yes | External system identifier |
| `email` | `string` | No | Email address |
| `display_name` | `string` | No | Display name |
| `roles` | `{ role: string; type: string; read_scope?: string; write_scope?: string }[]` | No | Initial role assignments (type: `superadmin`, `admin`, or `member`) |
| `metadata` | `Record<string, any>` | No | Arbitrary key-value metadata |

Each role entry forwards the optional work-surface scope fields `read_scope` (`self` or `all`, default `all`) and `write_scope` (`none`, `self`, or `all`, default `all`) to the API. Scope refines a `member` grant and is ignored for `admin`/`superadmin`. The constraint is **write ⊆ read** — `write_scope=all` requires `read_scope=all`. The default `all`/`all` is the full-queue worker. See [Roles API — Work-Surface Scope](../http/roles.md) for the five member profiles.

```typescript
// A one-time user who sees and acts only on their own pre-assigned item
const result = await lt.users.create({
  external_id: 'new-user',
  roles: [{ role: 'customer-triage', type: 'member', read_scope: 'self', write_scope: 'self' }],
});
```

**Returns:** `LTApiResult<User>` (status 201) -- returns 409 if `external_id` already exists.

**Auth:** Not required

---

## update

Update an existing user's profile fields. Only provided fields are changed.

```typescript
const result = await lt.users.update({
  id: 'user_123',
  display_name: 'Jane Smith',
  metadata: { department: 'engineering' },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | User UUID |
| `email` | `string` | No | New email address |
| `display_name` | `string` | No | New display name |
| `status` | `string` | No | New user status |
| `metadata` | `Record<string, any>` | No | Replacement metadata object |

**Returns:** `LTApiResult<User>` -- returns 404 if not found.

**Auth:** Not required

---

## delete

Delete a user by ID.

```typescript
const result = await lt.users.delete({ id: 'user_123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | User UUID |

**Returns:** `LTApiResult<{ deleted: true }>` -- returns 404 if not found.

**Auth:** Not required

---

## getRoles

Retrieve all roles assigned to a user.

```typescript
const result = await lt.users.getRoles({ id: 'user_123' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | User UUID |

**Returns:** `LTApiResult<{ roles: Role[] }>`

**Auth:** Not required

---

## addRole

Assign a role to a user.

```typescript
const result = await lt.users.addRole({
  id: 'user_123',
  role: 'reviewer',
  type: 'member',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | User UUID |
| `role` | `string` | Yes | Role name to assign |
| `type` | `string` | Yes | Role type (`superadmin`, `admin`, or `member`) |
| `read_scope` | `string` | No | `self` or `all` (default `all`). Search breadth for a `member`; ignored for admin/superadmin |
| `write_scope` | `string` | No | `none`, `self`, or `all` (default `all`). Claim/ack/delete breadth for a `member` |

`read_scope` and `write_scope` are the work-surface scope axes for a `member` grant: `read_scope` governs which escalations the member sees in search; `write_scope` governs which they may claim, ack (resolve), or delete (cancel). `self` means items assigned to the member; `all` means the whole role queue. The constraint is **write ⊆ read** — `write_scope=all` requires `read_scope=all`. Both default to `all` (full-queue worker), and both are ignored for `admin`/`superadmin`, which always act on the whole queue. The returned role object includes `read_scope` and `write_scope`. See [Roles API — Work-Surface Scope](../http/roles.md) for the five member profiles.

```typescript
// See the whole queue, act only on own items (e.g. a chat-style room)
const result = await lt.users.addRole({
  id: 'user_123',
  role: 'reviewer',
  type: 'member',
  read_scope: 'all',
  write_scope: 'self',
});
```

**Returns:** `LTApiResult<UserRole>` (status 201)

**Auth:** Not required

---

## removeRole

Remove a role from a user.

```typescript
const result = await lt.users.removeRole({
  id: 'user_123',
  role: 'reviewer',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | User UUID |
| `role` | `string` | Yes | Role name to remove |

**Returns:** `LTApiResult<{ removed: true }>` -- returns 404 if role not found.

**Auth:** Not required

---

## me — the authenticated caller

Self-service operations bound to the client's auth context (no ids, no admin gates).

### me.getPreferences

```typescript
const result = await lt.me.getPreferences();
// { status: 200, data: { preferences: { pinnedViews: [...] } } }
```

**Returns:** `LTApiResult<{ preferences: Record<string, unknown> }>` — `{}` when unset.

### me.patchPreferences

Shallow-merge a patch into the caller's preferences: top-level keys overwrite whole, `null` deletes a key. The merge is one guarded statement; the stored document is size-capped (~32 KB → 413).

```typescript
const result = await lt.me.patchPreferences({
  patch: {
    pinnedViews: [
      { id: 'pin-x1', label: 'Needs harvesting', url: '/escalations/available?role=fleet-servicer&jeopardy=1', badge: true },
    ],
  },
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `patch` | `object` | Yes | Preference keys to merge; a `null` value deletes its key |

**Returns:** `LTApiResult<{ preferences: Record<string, unknown> }>` — the merged document.

**Auth:** Required (the operation targets the caller).
