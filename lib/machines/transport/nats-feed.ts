/**
 * Long Tail's escalation events, two ways. The JetStream feed reads the
 * site stream that captures them over the leafnode, through a durable
 * consumer, so events published while the gateway was down are replayed.
 * The core feed subscribes to Long Tail's NATS directly: no stream, no
 * replay, and a not-yet-actionable event is retried in this process.
 */

import { connect, type ConsumerMessages, type NatsConnection, type Subscription } from 'nats';

import { payloadOf, readDurable } from './nats-durable';
import { LocalRedelivery, SerialQueue } from './serial';
import { LINE_STREAM, LT_ESCALATION_SUBJECTS, LT_EVENTS_STREAM, durableConsumer, ensureConsumer, ensureStreams } from './streams';
import { DISPOSITION, toEscalationEvent, type Disposition, type EscalationEvent, type EscalationFeed } from './delivery';

type Handler = (event: EscalationEvent) => Promise<Disposition>;

function decode(payload: string): EscalationEvent | null {
  try {
    return toEscalationEvent(JSON.parse(payload));
  } catch {
    return null;
  }
}

export interface JetStreamFeedOptions {
  natsUrl: string;
  user?: string;
  password?: string;
  durableName: string;
  nakDelayMs?: number;
}

export class JetStreamEscalationFeed implements EscalationFeed {
  private nc?: NatsConnection;
  private messages?: ConsumerMessages;
  private readonly queue = new SerialQueue();

  constructor(private readonly opts: JetStreamFeedOptions) {}

  async connect(): Promise<void> {
    const { natsUrl, user, password, durableName } = this.opts;
    this.nc = await connect({ servers: natsUrl, user, pass: password, name: durableName });
    const jsm = await this.nc.jetstreamManager();
    await ensureStreams(jsm, [LT_EVENTS_STREAM]);
    await ensureConsumer(jsm, LINE_STREAM.LT_EVENTS, durableConsumer(durableName, [LT_ESCALATION_SUBJECTS]));
  }

  async consume(handler: Handler): Promise<void> {
    if (!this.nc) throw new Error('escalation feed used before connect()');
    this.messages = await readDurable(this.nc.jetstream(), LINE_STREAM.LT_EVENTS, this.opts.durableName, this.queue, async (m) => {
      const event = decode(payloadOf(m));
      return event ? handler(event) : DISPOSITION.TERM;
    }, this.opts.nakDelayMs ?? 1_000);
  }

  async close(): Promise<void> {
    await this.messages?.close();
    await this.queue.drained();
    await this.nc?.drain();
  }
}

export interface CoreFeedOptions {
  natsUrl: string;
  token?: string;
  nakDelayMs?: number;
}

export class CoreEscalationFeed implements EscalationFeed {
  private nc?: NatsConnection;
  private sub?: Subscription;
  private readonly redelivery: LocalRedelivery;

  constructor(private readonly opts: CoreFeedOptions) {
    this.redelivery = new LocalRedelivery(new SerialQueue(), opts.nakDelayMs ?? 1_000);
  }

  async connect(): Promise<void> {
    this.nc = await connect({ servers: this.opts.natsUrl, token: this.opts.token, name: 'line-gateway-escalations' });
  }

  async consume(handler: Handler): Promise<void> {
    if (!this.nc) throw new Error('escalation feed used before connect()');
    this.sub = this.nc.subscribe(LT_ESCALATION_SUBJECTS, {
      callback: (_err, m) => {
        const event = decode(payloadOf(m));
        if (event) void this.redelivery.deliver(() => handler(event));
      },
    });
  }

  async close(): Promise<void> {
    this.sub?.unsubscribe();
    await this.redelivery.stop();
    await this.nc?.drain();
  }
}
