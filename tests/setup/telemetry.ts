import { telemetryRegistry } from '../../services/telemetry';
import { HoneycombTelemetryAdapter } from '../../services/telemetry/honeycomb';

/**
 * Whether telemetry export is enabled for this test run.
 * Set `TELEMETRY=true` to enable (requires HONEYCOMB_API_KEY).
 */
export const TELEMETRY = process.env.TELEMETRY === 'true';

/**
 * Connect the telemetry adapter if enabled.
 * Must be called BEFORE HotMesh workers start so spans are captured.
 */
export async function connectTelemetry(): Promise<void> {
  const honeycombKey = process.env.HONEYCOMB_API_KEY;
  if (TELEMETRY && honeycombKey) {
    telemetryRegistry.register(new HoneycombTelemetryAdapter({
      apiKey: honeycombKey,
      serviceName: 'long-tail-test',
    }));
    await telemetryRegistry.connect();
  }
}

/**
 * Disconnect and clear the telemetry adapter.
 * Call in afterAll to flush remaining spans.
 */
export async function disconnectTelemetry(): Promise<void> {
  await telemetryRegistry.disconnect();
  telemetryRegistry.clear();
}
