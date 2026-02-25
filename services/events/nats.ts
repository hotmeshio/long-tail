import { connect, NatsConnection, StringCodec } from 'nats';

import { config } from '../../modules/config';
import { loggerRegistry } from '../logger';
import type { LTEvent, LTEventAdapter } from '../../types';

const sc = StringCodec();

/**
 * NATS event adapter — reference implementation.
 *
 * Publishes LTEvent payloads as JSON to NATS subjects
 * following the pattern: `{subjectPrefix}.{event.type}`
 *
 * Usage:
 * ```typescript
 * import { eventRegistry, NatsEventAdapter } from '@hotmeshio/long-tail';
 *
 * eventRegistry.register(new NatsEventAdapter());
 * await eventRegistry.connect();
 * ```
 */
export class NatsEventAdapter implements LTEventAdapter {
  private nc: NatsConnection | null = null;
  private url: string;
  private subjectPrefix: string;

  constructor(options?: { url?: string; subjectPrefix?: string }) {
    this.url = options?.url || config.NATS_URL;
    this.subjectPrefix = options?.subjectPrefix || 'lt.events';
  }

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.url });
    loggerRegistry.info(`[lt-events:nats] connected to ${this.url}`);
  }

  async publish(event: LTEvent): Promise<void> {
    if (!this.nc) return;
    const subject = `${this.subjectPrefix}.${event.type}`;
    this.nc.publish(subject, sc.encode(JSON.stringify(event)));
  }

  async disconnect(): Promise<void> {
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      loggerRegistry.info('[lt-events:nats] disconnected');
    }
  }
}
