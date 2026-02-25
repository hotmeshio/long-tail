import pino from 'pino';
import type { LoggerOptions } from 'pino';

import type { LTLoggerAdapter } from '../../types/logger';

/**
 * Pino-based logging adapter.
 *
 * JSON output by default, sub-millisecond serialization, first-class
 * TypeScript types, and native OpenTelemetry integration via
 * `@opentelemetry/instrumentation-pino`.
 *
 * Usage:
 * ```typescript
 * import { loggerRegistry, PinoLoggerAdapter } from '@hotmeshio/long-tail';
 *
 * loggerRegistry.register(new PinoLoggerAdapter({ level: 'debug' }));
 * ```
 */
export class PinoLoggerAdapter implements LTLoggerAdapter {
  private logger: pino.Logger;

  constructor(options?: LoggerOptions) {
    this.logger = pino(options);
  }

  info(msg: string, context?: Record<string, any>): void {
    if (context) {
      this.logger.info(context, msg);
    } else {
      this.logger.info(msg);
    }
  }

  warn(msg: string, context?: Record<string, any>): void {
    if (context) {
      this.logger.warn(context, msg);
    } else {
      this.logger.warn(msg);
    }
  }

  error(msg: string, context?: Record<string, any>): void {
    if (context) {
      this.logger.error(context, msg);
    } else {
      this.logger.error(msg);
    }
  }

  debug(msg: string, context?: Record<string, any>): void {
    if (context) {
      this.logger.debug(context, msg);
    } else {
      this.logger.debug(msg);
    }
  }
}
