import type { LTEvent, LTEventAdapter } from '../../types';

class LTEventRegistry {
  private adapters: LTEventAdapter[] = [];
  private connected = false;

  /**
   * Register an event adapter. Call before connect().
   */
  register(adapter: LTEventAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * Connect all registered adapters. Call during startup.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    await Promise.allSettled(
      this.adapters.map((a) => a.connect()),
    );
    this.connected = true;
  }

  /**
   * Publish an event to all registered adapters.
   * Best-effort: individual adapter failures are logged, not thrown.
   */
  async publish(event: LTEvent): Promise<void> {
    if (!this.adapters.length) return;
    await Promise.allSettled(
      this.adapters.map((a) =>
        a.publish(event).catch((err) => {
          console.error('[lt-events] adapter publish failed:', err?.message);
        }),
      ),
    );
  }

  /**
   * Disconnect all registered adapters. Call during shutdown.
   */
  async disconnect(): Promise<void> {
    await Promise.allSettled(this.adapters.map((a) => a.disconnect()));
    this.connected = false;
  }

  /**
   * Remove all adapters and reset state. Used in tests.
   */
  clear(): void {
    this.adapters = [];
    this.connected = false;
  }

  /**
   * Check if any adapters are registered.
   */
  get hasAdapters(): boolean {
    return this.adapters.length > 0;
  }
}

/** Singleton event registry */
export const eventRegistry = new LTEventRegistry();
