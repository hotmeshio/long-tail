# TopicService

Topic catalog operations — browse, register, and manage event topic definitions.

Imported as a namespace:

```typescript
import { TopicService } from '@hotmeshio/long-tail';
```

## listTopics

List topics with optional filters.

```typescript
const result = await TopicService.listTopics({
  category: 'task',
  search: 'failed',
  limit: 50,
  offset: 0,
});
// result.topics: TopicCatalogEntry[]
// result.total: number
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | `string` | No | Filter by category |
| `search` | `string` | No | Search name or description |
| `limit` | `number` | No | Max results (default: 50) |
| `offset` | `number` | No | Pagination offset |

**Returns:** `{ topics: TopicCatalogEntry[], total: number }`

## getTopic

Get a single topic with its subscriber list.

```typescript
const topic = await TopicService.getTopic('task.created');
// topic.payload_schema — JSON Schema for event.data
// topic.subscribers — agents whose patterns match this topic
```

**Returns:** `TopicCatalogEntry & { subscribers: TopicSubscriber[] }` or `null`

Subscribers are matched using NATS-style pattern matching. An agent subscribed to `task.*` appears in the `task.created` subscriber list.

## createTopic

Register a new topic in the catalog.

```typescript
const entry = await TopicService.createTopic({
  topic: 'app.vendor.orders.created',
  description: 'Fired when a new order is placed.',
  category: 'app',
  payload_schema: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      total: { type: 'number' },
    },
  },
  tags: ['orders', 'lifecycle'],
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | `string` | Yes | Unique topic name |
| `category` | `string` | Yes | Topic category |
| `description` | `string` | No | Human-readable description |
| `payload_schema` | `object` | No | JSON Schema for `event.data` |
| `example_payload` | `object` | No | Example `event.data` |
| `source` | `string` | No | Source identifier (default: `'app'`) |
| `tags` | `string[]` | No | Tags for filtering |

**Returns:** `TopicCatalogEntry`

**Throws:** Postgres unique violation if topic already exists.

## updateTopic

Partial update of a topic's metadata.

```typescript
const updated = await TopicService.updateTopic('app.vendor.orders.created', {
  description: 'Updated description',
  tags: ['orders', 'critical'],
});
```

**Returns:** `TopicCatalogEntry | null`

## deleteTopic

Delete a topic. The SQL guards against deleting system topics (`source != 'system'`).

```typescript
const deleted = await TopicService.deleteTopic('app.vendor.orders.created');
// deleted: true/false
```

**Returns:** `boolean`

## seedTopic

Insert-if-absent. Used at startup for first-boot seeding.

```typescript
const inserted = await TopicService.seedTopic({
  topic: 'app.orders.created',
  description: 'New order placed',
  category: 'app',
  tags: ['orders'],
});
// inserted: true if new, false if already existed
```

**Returns:** `boolean`

## resetTopic

Upsert from config — overwrites description, category, schema, and tags on every call. Used when `reset: true` is set in static config.

```typescript
await TopicService.resetTopic({
  topic: 'app.orders.created',
  description: 'New order placed (updated)',
  category: 'app',
  payload_schema: { type: 'object', properties: { orderId: { type: 'string' } } },
});
```

**Returns:** `void`

## upsertTopicOnPublish

Auto-register or update a topic when an event is published. Creates the entry on first publish; updates `last_seen_at` and `example_payload` on subsequent publishes.

```typescript
await TopicService.upsertTopicOnPublish(
  'app.vendor.orders.error',
  { orderId: '123', error: 'timeout' },  // example data
  'order-processor',                       // source
);
```

Called automatically by the `publish_event` MCP tool. You only need this for manual publish paths.

**Returns:** `void`

---

## Types

### TopicCatalogEntry

```typescript
interface TopicCatalogEntry {
  topic: string;
  description?: string;
  category: string;
  payload_schema?: Record<string, any>;
  example_payload?: Record<string, any>;
  source: string;            // 'system', 'config', 'app', 'mcp-tool'
  tags: string[];
  subscriber_count?: number; // populated by listTopics
  last_seen_at?: string;     // ISO 8601, updated on each publish
  created_at: string;
  updated_at: string;
}
```

### TopicSubscriber

```typescript
interface TopicSubscriber {
  id: string;
  agent_id: string;
  agent_name: string;
  topic: string;             // the subscription pattern
  reaction_type: string;     // 'durable', 'pipeline', 'mcp_query'
}
```

## Seeding helpers

For advanced startup flows, two seeding functions are also exported from the package root:

```typescript
import { seedSystemTopics, seedConfigTopics } from '@hotmeshio/long-tail';

// Seed the 22 built-in system topics
await seedSystemTopics();

// Seed user-declared topics (respects reset: true)
await seedConfigTopics([
  { topic: 'app.orders.created', description: 'Order placed', reset: true },
]);
```

These are called automatically by `start()`. You only need them if you're building a custom startup flow.
