import type { GatewayLog, GatewayLogEvent } from '../gateway/log';

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  event: GatewayLogEvent;
  context: Record<string, unknown>;
}

/** A gateway log that keeps every entry, for assertions. */
export class RecordingLog implements GatewayLog {
  readonly entries: LogEntry[] = [];

  info(event: GatewayLogEvent, context: Record<string, unknown> = {}): void {
    this.entries.push({ level: 'info', event, context });
  }

  warn(event: GatewayLogEvent, context: Record<string, unknown> = {}): void {
    this.entries.push({ level: 'warn', event, context });
  }

  error(event: GatewayLogEvent, context: Record<string, unknown> = {}): void {
    this.entries.push({ level: 'error', event, context });
  }

  of(event: GatewayLogEvent): Record<string, unknown>[] {
    return this.entries.filter((e) => e.event === event).map((e) => e.context);
  }
}
