# Bot Accounts API

Bot accounts are named service identities that authenticate with API keys instead of passwords. They share the same role-based access control as human users. All endpoints require admin access.

## List bots

```
GET /api/bot-accounts
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | `integer` | Max results (default: 50) |
| `offset` | `integer` | Pagination offset (default: 0) |

**Response 200:**

```json
{
  "bots": [
    {
      "id": "a1b2c3d4-...",
      "external_id": "ci-bot",
      "display_name": "CI Bot",
      "account_type": "bot",
      "description": "Runs scheduled workflows",
      "status": "active",
      "roles": [
        { "role": "scheduler", "type": "member", "created_at": "2025-03-01T00:00:00.000Z" }
      ],
      "created_at": "2025-03-01T00:00:00.000Z",
      "updated_at": "2025-03-01T00:00:00.000Z"
    }
  ],
  "total": 1
}
```

## Get bot details

```
GET /api/bot-accounts/:id
```

**Response 200:** A single bot object.

**Response 404:**

```json
{ "error": "Bot not found" }
```

## Create bot

```
POST /api/bot-accounts
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Unique identifier (used as `external_id`) |
| `display_name` | `string` | no | Human-readable name |
| `description` | `string` | no | Purpose of this bot |
| `roles` | `array` | no | Initial role assignments: `[{ role, type }]` |

**Response 201:** The created bot object.

**Response 409:**

```json
{ "error": "Bot with this name already exists" }
```

## Update bot

```
PUT /api/bot-accounts/:id
```

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `display_name` | `string` | New display name |
| `description` | `string` | New description |
| `status` | `string` | `active`, `inactive`, or `suspended` |

**Response 200:** The updated bot object.

## Delete bot

```
DELETE /api/bot-accounts/:id
```

Deletes the bot and all its API keys (cascade).

**Response 200:**

```json
{ "deleted": true }
```

## Bot roles

Roles work identically to user roles.

```
GET    /api/bot-accounts/:id/roles
POST   /api/bot-accounts/:id/roles       { "role": "scheduler", "type": "member" }
DELETE /api/bot-accounts/:id/roles/:role
```

## API keys

### Generate key

```
POST /api/bot-accounts/:id/api-keys
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | yes | Key name (unique per bot) |
| `scopes` | `string[]` | no | Allowed scopes (default: `[]`) |
| `expires_at` | `string` | no | ISO 8601 expiry date |

**Response 201:**

```json
{
  "id": "key-uuid",
  "rawKey": "lt_bot_a1b2c3d4e5f6..."
}
```

The `rawKey` is shown **once**. It cannot be retrieved again.

### List keys

```
GET /api/bot-accounts/:id/api-keys
```

Returns key metadata without secret values.

```json
{
  "keys": [
    {
      "id": "key-uuid",
      "name": "production",
      "scopes": ["mcp:tool:call"],
      "last_used_at": "2025-03-15T12:00:00.000Z",
      "created_at": "2025-03-01T00:00:00.000Z"
    }
  ]
}
```

### Revoke key

```
DELETE /api/bot-accounts/:id/api-keys/:keyId
```

**Response 200:**

```json
{ "revoked": true }
```

## Using a bot API key

Include the raw key as a Bearer token in any API request:

```bash
curl -H "Authorization: Bearer lt_bot_a1b2c3d4e5f6..." \
  http://localhost:3000/api/tasks
```

The bot authenticates through the same middleware as human users. RBAC checks use the bot's assigned roles.
