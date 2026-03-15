# Logging

All internal log output in Long Tail flows through a single logger registry. The registry delegates to whatever adapter is registered — Pino, Winston, Bunyan, or any class that implements the `LTLoggerAdapter` interface. Long Tail ships with a ready-made Pino adapter; enable it with `logging: { pino: { level: 'info' } }` in the `start()` config. When no adapter is registered, the registry falls back to `console.*` so log output is never silently dropped, but production deployments should always register a structured adapter. Roughly 15 call sites across the codebase — the main entry point, workers, maintenance routines, event handling, telemetry, database migrations, and the interceptor — use the registry directly. No call site chooses its own transport; all defer to whatever adapter is registered.

## Configuration via start()

The simplest way to configure logging is through the `start()` config:

```typescript
import { start } from '@hotmeshio/long-tail';

// Built-in Pino adapter
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  logging: { pino: { level: 'info' } },
});

// Custom adapter
await start({
  database: { connectionString: process.env.DATABASE_URL },
  workers: [ ... ],
  logging: { adapter: new WinstonAdapter() },
});
```

The logging adapter is registered first, before any other initialization, so all startup messages flow through it.

## Interface

The adapter contract is defined in `types/logger.ts`:

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LTLoggerAdapter {
  info(msg: string, context?: Record<string, any>): void;
  warn(msg: string, context?: Record<string, any>): void;
  error(msg: string, context?: Record<string, any>): void;
  debug(msg: string, context?: Record<string, any>): void;
}
```

Every method accepts a message string and an optional context object. The context is passed as-is to the underlying logger, so structured fields (request IDs, durations, error codes) propagate without serialization on the caller's side.

## Registry

`LTLoggerRegistry` (`services/logger/index.ts`) is a singleton that itself implements `LTLoggerAdapter`. Internal code calls `loggerRegistry.info(...)`, `loggerRegistry.error(...)`, and so on without knowing which adapter, if any, is backing it.

| Method | Purpose |
|---|---|
| `register(adapter)` | Set the active adapter. Subsequent log calls delegate to it. |
| `clear()` | Remove the active adapter and revert to console fallback. |
| `hasAdapter` | Boolean property indicating whether a custom adapter is registered. |

Registration can happen at any point during the application lifecycle. Calls made before an adapter is registered use the console fallback described below.

## Built-in Pino adapter

Long Tail ships a ready-made Pino adapter in `services/logger/pino.ts`. Its constructor accepts the standard Pino `LoggerOptions` object, so any Pino configuration -- log level, transports, redaction, serializers -- works without modification.

```typescript
import { loggerRegistry, PinoLoggerAdapter } from '@hotmeshio/long-tail';

loggerRegistry.register(new PinoLoggerAdapter({
  level: 'info',
  transport: { target: 'pino-pretty' }, // optional, for development
}));
```

### Pino features worth noting

- **JSON output by default.** Each log line is a single JSON object, ready for ingestion by Elasticsearch, Datadog, or any log aggregator that parses structured data.
- **Sub-millisecond serialization.** Pino's design avoids synchronous string concatenation in the hot path; serialization cost is negligible compared to the I/O it triggers.
- **First-class TypeScript support.** Type definitions ship with the `pino` package. The `PinoLoggerAdapter` preserves those types without additional wrapping.
- **OpenTelemetry integration.** The `@opentelemetry/instrumentation-pino` package automatically injects trace and span IDs into every log line when an OTEL SDK is active, correlating logs with distributed traces.

## Custom adapter

Any object that implements `LTLoggerAdapter` can serve as the adapter. Below is a Winston example:

```typescript
import winston from 'winston';
import type { LTLoggerAdapter } from '@hotmeshio/long-tail';

class WinstonAdapter implements LTLoggerAdapter {
  private logger = winston.createLogger({ /* ... */ });
  info(msg: string, context?: Record<string, any>) { this.logger.info(msg, context); }
  warn(msg: string, context?: Record<string, any>) { this.logger.warn(msg, context); }
  error(msg: string, context?: Record<string, any>) { this.logger.error(msg, context); }
  debug(msg: string, context?: Record<string, any>) { this.logger.debug(msg, context); }
}

loggerRegistry.register(new WinstonAdapter());
```

The same pattern applies to Bunyan, log4js, or a bespoke adapter that writes to a database. The only requirement is the four methods.

## Fallback behavior

When no adapter is registered, the registry routes calls to the console:

| Log level | Console method |
|---|---|
| `info` | `console.log` |
| `debug` | `console.log` |
| `warn` | `console.warn` |
| `error` | `console.error` |

This ensures that log output is never silently dropped, even in minimal setups where no logging library is installed. Once an adapter is registered via `register()`, the console fallback is bypassed entirely.
