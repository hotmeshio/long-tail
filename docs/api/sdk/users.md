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
| `roles` | `{ role: string; type: string }[]` | No | Initial role assignments (type: `superadmin`, `admin`, or `member`) |
| `metadata` | `Record<string, any>` | No | Arbitrary key-value metadata |

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
