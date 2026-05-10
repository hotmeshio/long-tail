# lt.knowledge

Knowledge store operations — domain-scoped key-value entries backed by PostgreSQL JSONB.

## listDomains

List all knowledge domains with entry counts.

```typescript
const result = await lt.knowledge.listDomains();
```

**Parameters:** None

**Returns:** `LTApiResult<{ domains: Array<{ domain, count, latest }> }>`

## listEntries

List entries within a domain.

```typescript
const result = await lt.knowledge.listEntries({
  domain: 'screenshot',
  search: 'google',
  tags: ['web'],
  limit: 50,
  offset: 0,
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Domain to query |
| `search` | `string` | No | Search by key name or tag (partial match) |
| `tags` | `string[]` | No | Filter by tag overlap |
| `limit` | `number` | No | Max results (default: 50, max: 200) |
| `offset` | `number` | No | Pagination offset |

**Returns:** `LTApiResult<{ entries: KnowledgeEntry[], total: number }>`

## getEntry

Get a single entry by domain and key.

```typescript
const result = await lt.knowledge.getEntry({
  domain: 'screenshot',
  key: 'google',
});
```

**Returns:** `LTApiResult<KnowledgeEntry>` or `{ found: false }` if not found.

## storeEntry

Create or update a knowledge entry. Data is merged by default; set `replace: true` to fully overwrite.

```typescript
const result = await lt.knowledge.storeEntry({
  domain: 'screenshot',
  key: 'google',
  data: { '2026-05-09': 'The Google homepage...' },
  tags: ['web'],
  replace: false,
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Domain |
| `key` | `string` | Yes | Entry key |
| `data` | `object` | Yes | JSONB data to store |
| `tags` | `string[]` | No | Tags (unioned on upsert) |
| `replace` | `boolean` | No | Full replacement instead of merge |

**Returns:** `LTApiResult<{ id, domain, key, created, updated_at }>`

## setField

Set a value at a specific JSONB path without overwriting sibling fields.

```typescript
const result = await lt.knowledge.setField({
  domain: 'research',
  key: 'screenshots',
  path: 'google.holiday',
  value: "Mother's Day doodle with flowers",
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domain` | `string` | Yes | Domain |
| `key` | `string` | Yes | Entry key |
| `path` | `string` | Yes | Dot-notation path |
| `value` | `any` | Yes | Value to set (any JSON type) |
| `tags` | `string[]` | No | Tags to union |

**Returns:** `LTApiResult<{ id, domain, key, created, updated_at }>`

## removeField

Remove a specific field at a JSONB path.

```typescript
const result = await lt.knowledge.removeField({
  domain: 'research',
  key: 'screenshots',
  path: 'google.legacy_data',
});
```

**Returns:** `LTApiResult<{ removed }>`

## deleteEntry

Permanently delete a knowledge entry.

```typescript
const result = await lt.knowledge.deleteEntry({
  domain: 'screenshot',
  key: 'google',
});
```

**Returns:** `LTApiResult<{ deleted, domain, key }>`
