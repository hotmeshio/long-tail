/**
 * Pluggable telemetry adapter interface.
 *
 * Implement this to route HotMesh's OpenTelemetry spans to your
 * observability backend (Honeycomb, Datadog, Grafana Tempo, etc.).
 *
 * The adapter's `connect()` method must register a global OTEL
 * TracerProvider BEFORE HotMesh workers start, so that HotMesh's
 * internal span creation is captured by the exporter.
 *
 * Usage:
 * ```typescript
 * import { LTTelemetryAdapter } from '@hotmeshio/long-tail';
 *
 * class MyDatadogAdapter implements LTTelemetryAdapter {
 *   async connect() { /* init OTEL SDK with Datadog exporter *​/ }
 *   async disconnect() { /* shutdown SDK *​/ }
 * }
 * ```
 */
export interface LTTelemetryAdapter {
  /** Initialize the OTEL SDK and register the global TracerProvider */
  connect(): Promise<void>;
  /** Graceful shutdown — flush pending spans and close the exporter */
  disconnect(): Promise<void>;
  /**
   * Optional URL template for deep-linking to a trace in your observability UI.
   * Use `{traceId}` as a placeholder, e.g.:
   * `https://ui.honeycomb.io/my-team/environments/prod/trace?trace_id={traceId}`
   */
  traceUrl?: string;
}
