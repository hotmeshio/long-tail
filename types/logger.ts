/**
 * Pluggable logging adapter interface.
 *
 * Implement this to route Long Tail's internal log output through a
 * structured logger (Pino, Winston, etc.).
 *
 * When no adapter is registered, Long Tail falls back to `console.*`.
 *
 * Usage:
 * ```typescript
 * import type { LTLoggerAdapter } from '@hotmeshio/long-tail';
 *
 * class MyLoggerAdapter implements LTLoggerAdapter {
 *   info(msg: string, context?: Record<string, any>) { /* ... *​/ }
 *   warn(msg: string, context?: Record<string, any>) { /* ... *​/ }
 *   error(msg: string, context?: Record<string, any>) { /* ... *​/ }
 *   debug(msg: string, context?: Record<string, any>) { /* ... *​/ }
 * }
 * ```
 */
export interface LTLoggerAdapter {
  info(msg: string, context?: Record<string, any>): void;
  warn(msg: string, context?: Record<string, any>): void;
  error(msg: string, context?: Record<string, any>): void;
  debug(msg: string, context?: Record<string, any>): void;
}
