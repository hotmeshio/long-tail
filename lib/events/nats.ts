import { randomUUID } from 'crypto';
import { connect, NatsConnection, StringCodec, Subscription } from 'nats';

import { config } from '../../modules/config';
import { loggerRegistry } from '../logger';
import type { LTEvent, LTEventAdapter } from '../../types';

const sc = StringCodec();

/**
 * NATS event adapter — publish AND subscribe.
 *
 * Publishes LTEvent payloads as JSON to NATS subjects
 * following the pattern: `{subjectPrefix}.{event.type}`
 *
 * When a CallbackEventAdapter is bridged via `setCallbackBridge()`,
 * this adapter also subscribes to `{subjectPrefix}.>` and forwards
 * events from other containers to the local callback adapter.
 * An `_originId` field prevents the publishing container from
 * re-dispatching its own events.
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
  private sub: Subscription | null = null;
  private url: string;
  private subjectPrefix: string;
  private token?: string;
  private originId = randomUUID();
  private callbackAdapter: LTEventAdapter | null = null;

  constructor(options?: { url?: string; subjectPrefix?: string; token?: string }) {
    this.url = options?.url || config.NATS_URL;
    this.subjectPrefix = options?.subjectPrefix || 'lt.events';
    this.token = options?.token || process.env.NATS_TOKEN || 'dev_api_secret';
  }

  /**
   * Bridge NATS → local callback adapter for cross-container dispatch.
   * Part of the LTEventAdapter contract. Call before `connect()`.
   */
  setCallbackBridge(adapter: LTEventAdapter): void {
    this.callbackAdapter = adapter;
  }

  async connect(): Promise<void> {
    this.nc = await connect({
      servers: this.url,
      token: this.token,
    });
    loggerRegistry.info(`[lt-events:nats] connected to ${this.url}`);

    // Subscribe to all events for cross-container bridging
    if (this.callbackAdapter) {
      const adapter = this.callbackAdapter;
      this.sub = this.nc.subscribe(`${this.subjectPrefix}.>`);
      loggerRegistry.info(`[lt-events:nats] subscribed to ${this.subjectPrefix}.> for cross-container bridge`);

      (async () => {
        for await (const msg of this.sub!) {
          try {
            const event = JSON.parse(sc.decode(msg.data)) as LTEvent & { _originId?: string };
            // Skip events that originated from this container
            if (event._originId === this.originId) continue;
            adapter.publish(event);
          } catch {
            // Malformed message — skip
          }
        }
      })();
    }
  }

  async publish(event: LTEvent): Promise<void> {
    if (!this.nc) return;
    const subject = `${this.subjectPrefix}.${event.type}`;
    const enriched = { ...event, _originId: this.originId };
    this.nc.publish(subject, sc.encode(JSON.stringify(enriched)));
  }

  async disconnect(): Promise<void> {
    if (this.sub) {
      this.sub.unsubscribe();
      this.sub = null;
    }
    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      loggerRegistry.info('[lt-events:nats] disconnected');
    }
  }
}
