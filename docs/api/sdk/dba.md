# lt.dba

Database administration: prune stale data and deploy workflow schemas.

## prune

Prune stale HotMesh data from Redis. Selectively removes completed jobs, stream entries, engine/worker streams, and search attributes.

```typescript
const result = await lt.dba.prune({
  jobs: true,
  streams: true,
  expire: '7 days',
  entities: ['order', 'invoice'],
});
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `expire` | `string` | No | Redis TTL expression for pruned keys |
| `jobs` | `boolean` | No | Prune completed job hashes |
| `streams` | `boolean` | No | Prune activity streams |
| `engineStreams` | `boolean` | No | Prune engine consumer streams |
| `engineStreamsExpire` | `string` | No | TTL for engine stream entries |
| `workerStreams` | `boolean` | No | Prune worker consumer streams |
| `workerStreamsExpire` | `string` | No | TTL for worker stream entries |
| `attributes` | `boolean` | No | Prune FT.SEARCH attributes |
| `entities` | `string[]` | No | Limit pruning to these entity types |
| `pruneTransient` | `boolean` | No | Include transient keys |
| `keepHmark` | `boolean` | No | Preserve hmark keys |

**Returns:** `LTApiResult<PruneResult>`

**Auth:** Not required

---

## deploy

Deploy (or redeploy) all HotMesh workflow schemas. Updates the Redis execution graph across all registered entities. Safe to call repeatedly.

```typescript
const result = await lt.dba.deploy();
```

**Parameters:** None

**Returns:** `LTApiResult<{ ok: true }>`

**Auth:** Not required
