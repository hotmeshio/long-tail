import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import type { LTTelemetryAdapter } from '../../types/telemetry';
import { loggerRegistry } from '../logger';

export interface HoneycombOptions {
  /** Honeycomb API key (defaults to HONEYCOMB_API_KEY env var) */
  apiKey?: string;
  /** Service name reported to Honeycomb (defaults to 'long-tail') */
  serviceName?: string;
  /** Honeycomb OTLP endpoint (defaults to https://api.honeycomb.io) */
  endpoint?: string;
  /**
   * URL template for deep-linking to traces in Honeycomb UI.
   * Use `{traceId}` as a placeholder, e.g.:
   * `https://ui.honeycomb.io/my-team/environments/prod/trace?trace_id={traceId}`
   */
  traceUrl?: string;
}

/**
 * Honeycomb telemetry adapter.
 *
 * Configures the OpenTelemetry Node.js SDK with an OTLP exporter
 * pointed at Honeycomb. Once connected, all spans created by HotMesh
 * (workflow executions, activity calls, stream routing) are
 * automatically exported to Honeycomb.
 *
 * HotMesh uses `@opentelemetry/api` internally to create spans. This
 * adapter provides the TracerProvider + exporter that captures them.
 *
 * Usage:
 * ```typescript
 * import { telemetryRegistry } from './lib/telemetry';
 * import { HoneycombTelemetryAdapter } from './lib/telemetry/honeycomb';
 *
 * telemetryRegistry.register(new HoneycombTelemetryAdapter({
 *   apiKey: process.env.HONEYCOMB_API_KEY,
 *   serviceName: 'my-app',
 * }));
 * await telemetryRegistry.connect(); // before starting workers
 * ```
 */
export class HoneycombTelemetryAdapter implements LTTelemetryAdapter {
  private sdk: NodeSDK | null = null;
  private readonly apiKey: string;
  private readonly serviceName: string;
  private readonly endpoint: string;
  readonly traceUrl?: string;

  constructor(options?: HoneycombOptions) {
    this.apiKey = options?.apiKey || process.env.HONEYCOMB_API_KEY || '';
    this.serviceName = options?.serviceName || 'long-tail';
    this.endpoint = options?.endpoint || 'https://api.honeycomb.io';
    this.traceUrl = options?.traceUrl || HoneycombTelemetryAdapter.deriveTraceUrl(this.serviceName);
  }

  /**
   * Auto-derive the Honeycomb trace URL from standard env vars.
   * Returns undefined if HONEYCOMB_TEAM or HONEYCOMB_ENVIRONMENT are not set.
   */
  private static deriveTraceUrl(dataset: string): string | undefined {
    const team = process.env.HONEYCOMB_TEAM;
    const env = process.env.HONEYCOMB_ENVIRONMENT;
    if (!team || !env) return undefined;
    return `https://ui.honeycomb.io/${team}/environments/${env}/datasets/${dataset}/trace?trace_id={traceId}`;
  }

  async connect(): Promise<void> {
    if (!this.apiKey) {
      loggerRegistry.warn('[telemetry] HONEYCOMB_API_KEY not set — skipping Honeycomb telemetry');
      return;
    }

    const exporter = new OTLPTraceExporter({
      url: `${this.endpoint}/v1/traces`,
      headers: {
        'x-honeycomb-team': this.apiKey,
      },
    });

    this.sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.serviceName,
      }),
      traceExporter: exporter,
    });

    this.sdk.start();
    loggerRegistry.info(`[telemetry] Honeycomb connected (service: ${this.serviceName})`);
  }

  async disconnect(): Promise<void> {
    if (!this.sdk) return;
    await this.sdk.shutdown();
    this.sdk = null;
    loggerRegistry.info('[telemetry] Honeycomb disconnected');
  }
}
