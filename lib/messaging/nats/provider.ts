/**
 * Messaging on NATS. One connection carries pub/sub (core NATS subjects) and,
 * when the server runs JetStream for this account, durable streams. Without
 * JetStream the provider still serves pub/sub and reports no streams.
 */

import { connect, type NatsConnection, type Subscription } from 'nats';

import type { LTMessage, LTMessagingProvider, LTPubSub, LTStreams, LTSubscription, Subject } from '../../../types/messaging';
import { loggerRegistry } from '../../logger';
import { MESSAGING_LOG } from '../constants';
import { NatsStreams, payloadOf } from './streams';

export interface NatsMessagingOptions {
  url: string;
  /** Token auth, or user and password; neither for an open server. */
  token?: string;
  user?: string;
  password?: string;
  /** The connection's name on the server. */
  name?: string;
}

class NatsPubSub implements LTPubSub {
  constructor(private readonly nc: () => NatsConnection) {}

  async publish(subject: Subject, payload: string): Promise<void> {
    this.nc().publish(subject, payload);
  }

  subscribe(filter: Subject, handler: (m: LTMessage) => void): LTSubscription {
    const sub: Subscription = this.nc().subscribe(filter, {
      callback: (err, m) => { if (!err) handler({ subject: m.subject, payload: payloadOf(m) }); },
    });
    return { close: async () => { sub.unsubscribe(); } };
  }
}

export class NatsMessagingProvider implements LTMessagingProvider {
  readonly name = 'nats';
  readonly pubsub: LTPubSub = new NatsPubSub(() => this.connection());
  private nc: NatsConnection | null = null;
  private durable: LTStreams | null = null;

  constructor(private readonly opts: NatsMessagingOptions) {}

  get connected(): boolean {
    return !!this.nc && !this.nc.isClosed();
  }

  get streams(): LTStreams | null {
    return this.durable;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const { url, token, user, password, name } = this.opts;
    this.nc = await connect({ servers: url, token, user, pass: password, name });
    this.durable = await this.jetStream(this.nc);
  }

  async disconnect(): Promise<void> {
    if (!this.nc) return;
    await this.nc.drain();
    this.nc = null;
    this.durable = null;
  }

  /** Streams when the account has JetStream; null otherwise, and pub/sub still serves. */
  private async jetStream(nc: NatsConnection): Promise<LTStreams | null> {
    try {
      const jsm = await nc.jetstreamManager();
      await jsm.getAccountInfo();
      return new NatsStreams(jsm, nc.jetstream());
    } catch (err: any) {
      const reason = String(err?.message ?? err?.code ?? err);
      if (!/jetstream not enabled|503|no responders/i.test(reason)) {
        loggerRegistry.warn(`${MESSAGING_LOG.STREAMS_UNAVAILABLE} provider=${this.name} reason=${reason}`);
      }
      return null;
    }
  }

  private connection(): NatsConnection {
    if (!this.nc) throw new Error('NATS messaging is not connected; call connect() first');
    return this.nc;
  }
}
