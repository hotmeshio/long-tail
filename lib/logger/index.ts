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
const LOG_LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function shouldLog(level: string): boolean {
  const threshold = LOG_LEVELS[process.env.LOG_LEVEL || 'debug'] ?? 3;
  return (LOG_LEVELS[level] ?? 3) <= threshold;
}

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
    } else if (shouldLog('info')) {
      console.log(msg);
    }
  }

  warn(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.warn(msg, context);
    } else if (shouldLog('warn')) {
      console.warn(msg);
    }
  }

  error(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.error(msg, context);
    } else if (shouldLog('error')) {
      console.error(msg);
    }
  }

  debug(msg: string, context?: Record<string, any>): void {
    if (this.adapter) {
      this.adapter.debug(msg, context);
    } else if (shouldLog('debug')) {
      console.debug(msg);
    }
  }
}

/** Singleton logger registry */
export const loggerRegistry = new LTLoggerRegistry();
