# Events

Long Tail publishes structured events when workflows reach milestones. The default adapter uses Socket.IO, which is included in the Express server configuration and works out of the box with no additional infrastructure. The event system is pluggable: register additional adapters at startup to fan out events to NATS, SNS, webhooks, or any other pub/sub system alongside (or instead of) the default Socket.IO transport.

## Configuration via start()

The simplest way to enable event publishing is through the `start()` config:

```typescript
import { start } from '@hotmeshio/long-tail';

// Built-in NATS adapter
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  events: { nats: { url: 'nats://localhost:4222' } },
});

// Custom adapters (multiple supported)
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  events: { adapters: [new SnsEventAdapter(topicArn), new WebhookEventAdapter(url)] },
});
```

`start()` handles adapter connection and graceful disconnection on shutdown automatically.

## LTEvent

Every published event conforms to the `LTEvent` interface:

```typescript
interface LTEvent {
  type: string;              // 'milestone', 'escalation', 'task.completed', etc.
  source: string;            // 'interceptor' | 'orchestrator' | 'activity'
  workflowId: string;        // workflow instance ID
  workflowName: string;      // workflow function name
  taskQueue: string;         // task queue the workflow ran on
  taskId?: string;           // present when orchestrated
  activityName?: string;     // present when source is 'activity'
  milestones: LTMilestone[]; // milestones reported by the workflow
  data?: Record<string, any>;
  timestamp: string;         // ISO 8601
}
```

A milestone is a name/value pair:

```typescript
interface LTMilestone {
  name: string;
  value: string | number | boolean | Record<string, any>;
}
```

## LTEventAdapter

Adapters implement three methods:

```typescript
interface LTEventAdapter {
  connect(): Promise<void>;
  publish(event: LTEvent): Promise<void>;
  disconnect(): Promise<void>;
}
```

`connect()` is called once during startup. `publish()` is called for each event. `disconnect()` is called during graceful shutdown.

## Event Registry

`eventRegistry` is a singleton that manages adapters and dispatches events. The lifecycle is register, connect, publish, disconnect.

```typescript
import { eventRegistry, NatsEventAdapter } from '@hotmeshio/long-tail';

// 1. Register adapters (before connect)
eventRegistry.register(new NatsEventAdapter());

// 2. Connect all adapters
await eventRegistry.connect();

// ... application runs, events are published automatically ...

// 3. Disconnect during shutdown
await eventRegistry.disconnect();
```

### Behavior

- **Multiple adapters.** Call `register()` more than once to fan out events to several systems simultaneously.
- **Best-effort delivery.** `publish()` uses `Promise.allSettled`. A failure in one adapter does not affect the others and does not throw. Errors are logged.
- **Idempotent connect.** Calling `connect()` a second time is a no-op.
- **`hasAdapters`** returns `true` if at least one adapter is registered. The publishing functions check this flag and short-circuit when no adapters exist.
- **`clear()`** removes all adapters and resets connection state. Intended for test teardown.

## NATS Adapter

The built-in `NatsEventAdapter` publishes events as JSON-encoded strings to NATS subjects.

### Constructor Options

| Option          | Default                                      | Description                      |
|-----------------|----------------------------------------------|----------------------------------|
| `url`           | `process.env.NATS_URL` or `nats://localhost:4222` | NATS server URL             |
| `subjectPrefix` | `lt.events`                                  | Prefix for NATS subject names    |

### Subject Format

Events are published to `{subjectPrefix}.{event.type}`. A milestone event with the default prefix lands on:

```
lt.events.milestone
```

### Usage

```typescript
import { eventRegistry, NatsEventAdapter } from '@hotmeshio/long-tail';

// Default: connects to nats://localhost:4222, publishes to lt.events.*
eventRegistry.register(new NatsEventAdapter());

// Custom server and prefix
eventRegistry.register(new NatsEventAdapter({
  url: 'nats://nats.prod.internal:4222',
  subjectPrefix: 'myapp.events',
}));

await eventRegistry.connect();
```

On disconnect, the adapter calls `drain()` on the NATS connection, ensuring in-flight publishes complete before closing.

## In-Memory Adapter

`InMemoryEventAdapter` captures events in an array. It exists for testing.

```typescript
import { eventRegistry, InMemoryEventAdapter } from '@hotmeshio/long-tail';

const adapter = new InMemoryEventAdapter();
eventRegistry.register(adapter);
await eventRegistry.connect();

// ... run a workflow ...

// Inspect captured events
expect(adapter.events).toContainEqual(
  expect.objectContaining({
    type: 'milestone',
    workflowName: 'reviewContent',
  })
);

// Reset between tests
adapter.clear();
```

After each test, call `eventRegistry.clear()` to remove the adapter and reset connection state.

## Custom Adapters

For production, route events to your own pub/sub system.

Implement `LTEventAdapter` to route events to any pub/sub system. The registry handles error isolation, so adapters can throw freely -- failures are caught, logged, and do not propagate.

### Example: SNS

```typescript
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { LTEventAdapter, LTEvent } from '@hotmeshio/long-tail';

class SnsEventAdapter implements LTEventAdapter {
  private client: SNSClient;
  private topicArn: string;

  constructor(topicArn: string, region = 'us-east-1') {
    this.topicArn = topicArn;
    this.client = new SNSClient({ region });
  }

  async connect(): Promise<void> {
    // SNS client is ready on construction; nothing to do.
  }

  async publish(event: LTEvent): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify(event),
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: event.type,
          },
        },
      }),
    );
  }

  async disconnect(): Promise<void> {
    this.client.destroy();
  }
}
```

### Example: Webhook

```typescript
import type { LTEventAdapter, LTEvent } from '@hotmeshio/long-tail';

class WebhookEventAdapter implements LTEventAdapter {
  constructor(private url: string) {}

  async connect(): Promise<void> {}

  async publish(event: LTEvent): Promise<void> {
    await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  }

  async disconnect(): Promise<void> {}
}
```

## When Events Fire

Regardless of which adapter receives them, all events originate from three places in the system.

Milestone events are published from three call sites, distinguished by the `source` field:

### 1. Workflow interceptor (`source: 'interceptor'`)

When a workflow returns `{ type: 'return', milestones, data }`, the interceptor's `handleCompletion` function publishes a milestone event before signaling the parent orchestrator. If the workflow is a re-run following an escalation, the interceptor appends two additional milestones -- `escalated: true` and `resolved_by_human: true` -- before publishing.

### 2. Orchestrator activity (`source: 'orchestrator'`)

When the orchestrator completes a task via `ltCompleteTask`, it publishes a milestone event with the task's milestones. This covers orchestrated workflows where the parent orchestrator is responsible for recording task completion.

### 3. Activity interceptor (`source: 'activity'`)

The activity interceptor inspects every activity result. If the result contains a `milestones` array, it publishes a milestone event with `activityName` set. This allows individual activities -- not just entire workflows -- to report progress.

### Delivery Semantics

All three call sites use `publishMilestoneEvent()`, which is fire-and-forget. It returns immediately, never throws, and swallows errors. Events are a non-durable side effect: they are not replayed on workflow recovery. If the process crashes between task completion and event publication, the event is lost. Design downstream consumers accordingly.
