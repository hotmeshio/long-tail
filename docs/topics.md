# Topic Catalog

The topic catalog is a persistent registry of known event topics. Every topic has a name, description, payload schema, and metadata — making the event bus discoverable, documented, and queryable.

Topics are the foundation of agentic automation. Agents subscribe to topics and react when events fire. The catalog tells agents (and humans) what topics exist, what data they carry, and who's listening.

## How topics enter the catalog

Topics arrive through three paths:

### 1. System topics (built-in)

The platform seeds 22 system topics at startup — one for every `LTEventType`. These describe the lifecycle events the platform emits automatically: task, workflow, escalation, activity, knowledge, agent, and milestone events.

System topics are read-only. They can't be deleted or renamed. Their schemas are derived directly from the publish helpers in the source code.

### 2. Config topics (declared in code)

Projects declare topics in `startConfig.topics[]`. This is the primary way applications document what they publish:

```typescript
import { start } from '@hotmeshio/long-tail';

await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [{ taskQueue: 'orders', workflow: processOrder }],

  topics: [
    {
      topic: 'app.orders.created',
      description: 'Fired when a new order is placed.',
      payload_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          total: { type: 'number' },
          customer: { type: 'string' },
        },
      },
      example_payload: { orderId: 'ord-123', total: 99.99, customer: 'acme' },
      tags: ['orders', 'lifecycle'],
    },
    {
      topic: 'app.orders.failed',
      description: 'Fired when order processing fails.',
      payload_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          error: { type: 'string' },
        },
      },
      tags: ['orders', 'error'],
      reset: true,  // config is source of truth — overwrite DB on every boot
    },
  ],
});
```

Config topics are seeded on first boot (insert-if-absent). The database owns the record after that — dashboard edits stick.

### 3. Runtime topics (auto-discovered)

When the `publish_event` MCP tool fires with a topic that isn't in the catalog, the system auto-registers it. The topic appears in the catalog with the payload as an example. This is learn-on-first-use — topics accumulate over time.

## The reset flag

By default, config topics follow insert-if-absent semantics. Once seeded, the database owns the record. Dashboard edits persist across restarts.

Set `reset: true` to make config the source of truth:

```typescript
{
  topic: 'app.orders.created',
  description: 'Updated description from code',
  reset: true,
}
```

With `reset: true`:
- Every boot overwrites description, schema, tags from the config
- Dashboard edits are transient — next deploy resets them
- The topic definition lives in git, reviewed in PRs, enforced by CI/CD

Without `reset`:
- First boot seeds the record
- Dashboard edits persist
- Config changes in code are ignored after first boot

## Topic naming

Topics are dot-delimited strings. The convention:

| Prefix | Who publishes | Example |
|--------|--------------|---------|
| `task.*` | Platform (automatic) | `task.created`, `task.failed` |
| `workflow.*` | Platform (automatic) | `workflow.completed` |
| `escalation.*` | Platform (automatic) | `escalation.resolved` |
| `activity.*` | Platform (automatic) | `activity.started` |
| `knowledge.*` | Platform (automatic) | `knowledge.stored` |
| `agent.*` | Platform (automatic) | `agent.status_changed` |
| `milestone` | Platform (automatic) | `milestone` |
| `app.*` | Application code | `app.vendor.orders.created` |

Application topics follow `app.{namespace}.{entity}.{action}`. The `app.` prefix is auto-added by the `publish_event` MCP tool if omitted.

## Payload schemas

Each topic can carry a JSON Schema describing the `event.data` shape. This serves two purposes:

1. **Documentation** — developers and agents know what fields are available
2. **Input mapping** — when wiring a subscription, the schema shows what `{event.data.*}` templates resolve to

System topics have schemas derived from the publish helpers. Config topics declare schemas explicitly. Runtime topics learn by example.

## Categories

Every topic belongs to a category: `task`, `workflow`, `escalation`, `activity`, `knowledge`, `agent`, `app`, or `milestone`. Categories are inferred from the first segment of the topic name. The dashboard uses categories for filtering and color-coding.

## Subscriber discovery

The topic detail view shows which agents subscribe. This uses the same NATS-style pattern matching as the event bus — if an agent subscribes to `task.*`, it appears on every `task.created`, `task.failed`, etc. detail page.

## MCP tools

Two MCP tools give agents programmatic access to the catalog:

- **`list_topics`** — browse topics by category or search term
- **`register_topic`** — declare a topic with schema before first publish

This enables autonomous wiring: an agent can discover available topics, read their schemas, and create subscriptions — all through tool calls.

## LTTopicConfig

The TypeScript interface for static topic declarations:

```typescript
interface LTTopicConfig {
  topic: string;
  description?: string;
  category?: string;           // defaults to first segment or 'app'
  payload_schema?: object;     // JSON Schema for event.data
  example_payload?: object;    // concrete example
  tags?: string[];
  reset?: boolean;             // true = config is source of truth
}
```

## Related

- [Events](events.md) — transport adapters, event registry, publishing
- [Agents: Subscriptions](agents.md#subscriptions) — wiring topics to workflows
- [Topics HTTP API](api/http/topics.md) — REST endpoints
- [Topics SDK](api/sdk/topics.md) — `TopicService` namespace
