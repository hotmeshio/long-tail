/**
 * Long Tail's escalation events for a gateway running outside Long Tail: a
 * subscription to Long Tail's NATS. Nothing is replayed; a not-yet-actionable
 * event is retried in this process, and the gateway reconciles open rows
 * when it starts leading a line.
 */

import { connect, type NatsConnection, type Subscription } from 'nats';

import { payloadOf } from './nats-durable';
import { LocalRedelivery, SerialQueue } from './serial';
import { toEscalationEvent, type Disposition, type EscalationEvent, type EscalationFeed } from './delivery';

type Handler = (event: EscalationEvent) => Promise<Disposition>;

/** Long Tail publishes every LTEvent as `lt.events.<type>`. */
export const LT_ESCALATION_SUBJECTS = 'lt.events.system.escalation.>';

function decode(payload: string): EscalationEvent | null {
  try {
    return toEscalationEvent(JSON.parse(payload));
  } catch {
    return null;
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
