Pluggable OpenTelemetry integration with a singleton registry pattern. Must be connected before HotMesh workers start so spans are captured from the first workflow execution.

Key files:
- `index.ts` — `LTTelemetryRegistry` singleton: `register(adapter)`, `connect()`, `disconnect()`, `clear()`, `traceUrl`. Unlike the event registry (multi-adapter fan-out), telemetry uses a single adapter because OTEL only supports one global `TracerProvider`.
- `honeycomb.ts` — `HoneycombTelemetryAdapter`: configures the OpenTelemetry Node.js SDK with an OTLP exporter pointed at Honeycomb. Options: `apiKey`, `serviceName`, `endpoint`, `traceUrl`. Auto-derives trace URL from `HONEYCOMB_TEAM` and `HONEYCOMB_ENVIRONMENT` env vars.

No SQL or LLM prompts. The `LTTelemetryAdapter` interface is defined in `types/telemetry.ts`. HotMesh creates spans internally via `@opentelemetry/api`; this adapter provides the `TracerProvider` + exporter that captures them.
