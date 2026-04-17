import type { LTLoggerAdapter } from '../../types/logger';

/**
 * Singleton registry for the logging adapter.
 *
 * Follows the same pattern as telemetryRegistry and eventRegistry:
 * - register(adapter) — set the logging adapter
 * - clear()           — reset (for tests)
 *
 * When no adapter is registered, all methods fall back to console.*.
 */
class LTLoggerRegistry implements LTLoggerAdapter {
  private adapter: LTLoggerAdapter | null = null;

  /**
   * Register a logging adapter. Replaces any previously registered adapter.
   */
  register(adapter: LTLoggerAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Remove the adapter and reset state. Used in tests.
   */
  clear(): void {
    this.adapter = null;
  }

  /**
   * Check if an adapter is registered.
   */
  get hasAdapter(): boolean {
    return this.adapter !== null;
  }

  info(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.info(msg, context);
    } else {
      console.log(msg);
    }
  }

  warn(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.warn(msg, context);
    } else {
      console.warn(msg);
    }
  }

  error(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.error(msg, context);
    } else {
      console.error(msg);
    }
  }

  debug(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.debug(msg, context);
    } else {
      console.debug(msg);
    }
  }
}

/** Singleton logger registry */
export const loggerRegistry = new LTLoggerRegistry();
