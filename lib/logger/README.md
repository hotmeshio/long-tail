Pluggable logging service with a singleton registry pattern. Falls back to `console.*` when no adapter is registered.

Key files:
- `index.ts` — `LTLoggerRegistry` singleton implementing `LTLoggerAdapter`. Methods: `register(adapter)`, `clear()`, `info()`, `warn()`, `error()`, `debug()`. Each method delegates to the registered adapter or falls back to the corresponding `console.*` call.
- `pino.ts` — `PinoLoggerAdapter`: wraps a `pino.Logger` instance, supports structured JSON logging and OpenTelemetry integration via `@opentelemetry/instrumentation-pino`

No SQL or LLM prompts. The `LTLoggerAdapter` interface is defined in `types/logger.ts`.
