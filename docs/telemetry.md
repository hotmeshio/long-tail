# Telemetry

Long Tail instruments workflow execution through OpenTelemetry. HotMesh, the underlying workflow engine, creates spans for workflow triggers, activity calls, stream routing, and errors. These spans are exported automatically once a telemetry adapter registers a global `TracerProvider`. No manual span creation is required in workflow or activity code.

The system has three parts: an adapter interface, a singleton registry, and one or more adapter implementations. Long Tail ships with a Honeycomb adapter. You can write your own for any OTLP-compatible backend.

## Configuration via start()

The simplest way to enable telemetry is through the `start()` config:

```typescript
import { start } from '@hotmeshio/long-tail';

// Built-in Honeycomb adapter
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  telemetry: { honeycomb: { apiKey: process.env.HONEYCOMB_API_KEY } },
});

// Custom adapter
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  telemetry: { adapter: new DatadogAdapter() },
});
```

`start()` handles initialization order automatically — the telemetry adapter is connected before workers start, ensuring spans are captured from the first workflow execution.

## Adapter Interface

```typescript
import type { LTTelemetryAdapter } from '@hotmeshio/long-tail';

interface LTTelemetryAdapter {
  /** Initialize the OTEL SDK and register the global TracerProvider */
  connect(): Promise<void>;
  /** Flush pending spans and shut down the exporter */
  disconnect(): Promise<void>;
}
```

The interface is deliberately minimal. `connect()` starts the OpenTelemetry SDK and registers the global `TracerProvider`. `disconnect()` flushes buffered spans and shuts down the SDK. All instrumentation happens inside HotMesh via `@opentelemetry/api` — the adapter's only job is to provide the provider and exporter.

## Registry

`telemetryRegistry` is a singleton that holds one adapter. Unlike the event registry (which supports multiple adapters), telemetry uses a single adapter because OpenTelemetry permits only one global `TracerProvider` at a time.

```typescript
import { telemetryRegistry } from '@hotmeshio/long-tail';

telemetryRegistry.register(adapter);   // store the adapter
await telemetryRegistry.connect();     // delegate to adapter.connect()
await telemetryRegistry.disconnect();  // delegate to adapter.disconnect()
telemetryRegistry.clear();             // remove the adapter (used in tests)
telemetryRegistry.hasAdapter;          // boolean — true if an adapter is registered
```

`connect()` is idempotent. Calling it twice has no effect. `register()` replaces any previously registered adapter.

## Initialization Order

The adapter must be registered and connected **before** workers start. HotMesh creates its tracers during worker initialization. If no `TracerProvider` is registered at that point, spans are silently discarded for the lifetime of the process.

`start()` handles this automatically — it connects the telemetry adapter before creating any workers. If you register the adapter programmatically instead, ensure you call `connect()` before starting workers.

## Built-in Honeycomb Adapter

```typescript
import { telemetryRegistry, HoneycombTelemetryAdapter } from '@hotmeshio/long-tail';

telemetryRegistry.register(new HoneycombTelemetryAdapter({
  apiKey: process.env.HONEYCOMB_API_KEY,
  serviceName: 'my-app',
}));
await telemetryRegistry.connect();
```

### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | `process.env.HONEYCOMB_API_KEY` | Honeycomb API key. If empty, `connect()` logs a warning and returns without starting the SDK. |
| `serviceName` | `string` | `'long-tail'` | The `service.name` resource attribute sent with every span. |
| `endpoint` | `string` | `'https://api.honeycomb.io'` | OTLP endpoint. Override for Honeycomb EU or a local collector. |

The adapter uses `@opentelemetry/sdk-node` with `@opentelemetry/exporter-trace-otlp-proto` (HTTP). It sends traces to `{endpoint}/v1/traces` with the API key in the `x-honeycomb-team` header.

## Custom Adapter

Any class that implements `LTTelemetryAdapter` works. The pattern is the same regardless of backend: initialize a `NodeSDK` with the appropriate exporter in `connect()`, shut it down in `disconnect()`.

### Datadog Example

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import type { LTTelemetryAdapter } from '@hotmeshio/long-tail';

class DatadogAdapter implements LTTelemetryAdapter {
  private sdk: NodeSDK | null = null;

  async connect() {
    this.sdk = new NodeSDK({ /* Datadog exporter config */ });
    this.sdk.start();
  }

  async disconnect() {
    await this.sdk?.shutdown();
  }
}
```

Register it the same way:

```typescript
telemetryRegistry.register(new DatadogAdapter());
await telemetryRegistry.connect();
```

## HMSH_TELEMETRY Environment Variable

The `HMSH_TELEMETRY` environment variable controls span verbosity at the HotMesh engine level. It determines which spans HotMesh creates, independent of which backend receives them.

| Value | Spans emitted |
|-------|---------------|
| `info` | Workflow triggers, worker lifecycle, errors |
| `debug` | Everything in `info`, plus every activity execution |
| *(unset)* | No spans created |

Set this on the worker container. The API container does not execute workflows and does not need it.

```bash
HMSH_TELEMETRY=info      # production — trigger and error spans
HMSH_TELEMETRY=debug     # development — every activity call
```

## Pino and OTEL Correlation

When using both the telemetry adapter and the Pino logging adapter, add `@opentelemetry/instrumentation-pino` to your OTEL SDK configuration. This injects `trace_id` and `span_id` fields into every Pino log line, correlating logs with distributed traces in your observability backend.

The instrumentation must be included in the `NodeSDK` setup inside your telemetry adapter's `connect()` method — it hooks into Pino at the SDK level, not through Long Tail's logger registry.
