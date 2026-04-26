# lt.botAccounts

Manage bot accounts, their role assignments, and API keys.

## list

List all bot accounts with pagination.

```typescript
const result = await lt.botAccounts.list({ limit: 50, offset: 0 });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `limit` | `number` | No | Maximum number of bots to return (default 50) |
| `offset` | `number` | No | Number of bots to skip for pagination (default 0) |

**Returns:** `LTApiResult<Bot[]>`

**Auth:** Not required

---

## get

Retrieve a single bot account by ID.

```typescript
const result = await lt.botAccounts.get({ id: 'bot-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot |

**Returns:** `LTApiResult<Bot>`

**Auth:** Not required

---

## create

Create a new bot account with optional roles.

```typescript
const result = await lt.botAccounts.create({
  name: 'deploy-bot',
  description: 'Automated deployment bot',
  roles: [{ role: 'deployer', type: 'member' }],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique bot name |
| `description` | `string` | No | Text description of the bot |
| `display_name` | `string` | No | Human-friendly display name |
| `roles` | `{ role: string, type: string }[]` | No | Roles to assign at creation (type must be `superadmin`, `admin`, or `member`) |

**Returns:** `LTApiResult<Bot>`

**Auth:** Optional (userId recorded as the bot creator when provided)

---

## update

Update mutable fields on an existing bot account.

```typescript
const result = await lt.botAccounts.update({ id: 'bot-id', display_name: 'New Name' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot to update |
| `display_name` | `string` | No | New display name |
| `description` | `string` | No | New description |
| `status` | `string` | No | New status value |

**Returns:** `LTApiResult<Bot>`

**Auth:** Not required

---

## delete

Delete a bot account by ID.

```typescript
const result = await lt.botAccounts.delete({ id: 'bot-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot to delete |

**Returns:** `LTApiResult<{ deleted: true }>`

**Auth:** Not required

---

## getRoles

List all roles assigned to a bot account.

```typescript
const result = await lt.botAccounts.getRoles({ id: 'bot-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot |

**Returns:** `LTApiResult<{ roles: Role[] }>`

**Auth:** Not required

---

## addRole

Assign a role to a bot account.

```typescript
const result = await lt.botAccounts.addRole({ id: 'bot-id', role: 'deployer', type: 'member' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot |
| `role` | `string` | Yes | Role name to assign |
| `type` | `string` | Yes | Role type (`superadmin`, `admin`, or `member`) |

**Returns:** `LTApiResult<Role>`

**Auth:** Not required

---

## removeRole

Remove a role from a bot account.

```typescript
const result = await lt.botAccounts.removeRole({ id: 'bot-id', role: 'deployer' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot |
| `role` | `string` | Yes | Role name to remove |

**Returns:** `LTApiResult<{ removed: true }>`

**Auth:** Not required

---

## listKeys

List all API keys for a bot account.

```typescript
const result = await lt.botAccounts.listKeys({ id: 'bot-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot |

**Returns:** `LTApiResult<{ keys: ApiKey[] }>`

**Auth:** Not required

---

## createKey

Create a new API key for a bot account.

```typescript
const result = await lt.botAccounts.createKey({
  id: 'bot-id',
  name: 'ci-deploy-key',
  scopes: ['deploy', 'read'],
  expires_at: '2025-12-31T23:59:59Z',
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier of the bot |
| `name` | `string` | Yes | Human-readable name for the API key |
| `scopes` | `string[]` | No | Permission scopes to restrict the key |
| `expires_at` | `string` | No | ISO 8601 expiration timestamp |

**Returns:** `LTApiResult<ApiKey>` (includes the secret -- only returned at creation time)

**Auth:** Not required

---

## revokeKey

Revoke an existing bot API key.

```typescript
const result = await lt.botAccounts.revokeKey({ keyId: 'key-id' });
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyId` | `string` | Yes | Unique identifier of the API key to revoke |

**Returns:** `LTApiResult<{ revoked: true }>`

**Auth:** Not required
