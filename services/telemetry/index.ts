import type { LTTelemetryAdapter } from '../../types/telemetry';

/**
 * Singleton registry for the telemetry adapter.
 *
 * Unlike the event registry (which fans out to multiple adapters),
 * telemetry uses a single adapter because OTEL only supports one
 * global TracerProvider at a time.
 *
 * The adapter must be registered and connected BEFORE HotMesh
 * workers start so that spans are captured from the first workflow.
 */
class LTTelemetryRegistry {
  private adapter: LTTelemetryAdapter | null = null;
  private connected = false;

  /**
   * Register a telemetry adapter. Call before connect().
   * Replaces any previously registered adapter.
   */
  register(adapter: LTTelemetryAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Connect the registered adapter (initializes OTEL SDK).
   * Must be called before HotMesh workers start.
   */
  async connect(): Promise<void> {
    if (this.connected || !this.adapter) return;
    await this.adapter.connect();
    this.connected = true;
  }

  /**
   * Disconnect the adapter (flush + shutdown OTEL SDK).
   * Call during graceful shutdown.
   */
  async disconnect(): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.disconnect();
    this.connected = false;
  }

  /**
   * Remove the adapter and reset state. Used in tests.
   */
  clear(): void {
    this.adapter = null;
    this.connected = false;
  }

  /**
   * Check if an adapter is registered.
   */
  get hasAdapter(): boolean {
    return this.adapter !== null;
  }
}

/** Singleton telemetry registry */
export const telemetryRegistry = new LTTelemetryRegistry();
