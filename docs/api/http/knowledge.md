# Knowledge API

CRUD operations for the knowledge store — a domain-scoped key-value store backed by PostgreSQL JSONB. Each entry has a domain, key, arbitrary JSON data, and optional tags.

All endpoints require authentication.

## List domains

```
GET /api/knowledge/domains
```

Returns all knowledge domains with entry counts and last-updated timestamps.

**Response 200:**

```json
{
  "domains": [
    { "domain": "screenshot", "count": 3, "latest": "2026-05-09T22:26:51.616Z" },
    { "domain": "config", "count": 1, "latest": "2026-05-08T10:00:00.000Z" }
  ]
}
```

## List entries

```
GET /api/knowledge/entries?domain=screenshot&search=google&tags=web&limit=50&offset=0
```

Returns entries within a domain, ordered by last updated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Domain to query |
| `search` | `string` | No | Search by key name or tag (ILIKE partial match) |
| `tags` | `string` | No | Comma-separated tag filter (array overlap) |
| `limit` | `number` | No | Max results (default: 50, max: 200) |
| `offset` | `number` | No | Pagination offset |

**Response 200:**

```json
{
  "entries": [
    {
      "id": "uuid",
      "domain": "screenshot",
      "key": "google",
      "data": { "2026-05-09": "description..." },
      "tags": ["web"],
      "created_at": "2026-05-09T22:26:51.616Z",
      "updated_at": "2026-05-09T22:26:51.616Z"
    }
  ],
  "total": 1
}
```

## Get entry

```
GET /api/knowledge/entry?domain=screenshot&key=google
```

Returns a single knowledge entry by domain and key. Returns `{ found: false }` if not found.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Domain |
| `key` | `string` | Yes | Entry key |

**Response 200:**

```json
{
  "id": "uuid",
  "domain": "screenshot",
  "key": "google",
  "data": { "2026-05-09": "The Google homepage..." },
  "tags": [],
  "created_at": "2026-05-09T22:26:51.616Z",
  "updated_at": "2026-05-09T22:26:51.616Z"
}
```

## Store entry

```
POST /api/knowledge/entry
```

Create or update a knowledge entry. By default, JSONB data is merged at the top level — new keys are added, existing keys are overwritten, but absent keys are preserved. Set `replace: true` to fully replace the data object (required when removing fields).

**Body:**

```json
{
  "domain": "screenshot",
  "key": "google",
  "data": { "2026-05-09": "The Google homepage..." },
  "tags": ["web"],
  "replace": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | `string` | Yes | Domain |
| `key` | `string` | Yes | Entry key |
| `data` | `object` | Yes | JSONB data (top level must be an object) |
| `tags` | `string[]` | No | Tags are unioned with existing tags on upsert |
| `replace` | `boolean` | No | When `true`, replaces data entirely instead of merging |

**Response 200:**

```json
{
  "id": "uuid",
  "domain": "screenshot",
  "key": "google",
  "created": false,
  "updated_at": "2026-05-09T22:26:51.616Z"
}
```

## Delete entry

```
DELETE /api/knowledge/entry?domain=screenshot&key=google
```

Permanently delete a knowledge entry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Domain |
| `key` | `string` | Yes | Entry key |

**Response 200:**

```json
{ "deleted": true, "domain": "screenshot", "key": "google" }
```

**Response 404:**

```json
{ "error": "Entry not found" }
```
