/**
 * Long Tail's escalation events for a gateway running outside Long Tail, over
 * Long Tail's messaging pub/sub. Nothing is replayed; a not-yet-actionable
 * event is retried in this process, and the gateway reconciles open rows when
 * it starts leading a line.
 */

import type { LTPubSub, LTSubscription } from '../../../types/messaging';
import { LT_SUBJECTS } from '../../messaging/constants';
import { LocalRedelivery, SerialQueue } from './serial';
import { toEscalationEvent, type Disposition, type EscalationEvent, type EscalationFeed } from './delivery';

export class PubSubEscalationFeed implements EscalationFeed {
  private sub?: LTSubscription;
  private readonly redelivery: LocalRedelivery;

  constructor(private readonly pubsub: LTPubSub, nakDelayMs = 1_000) {
    this.redelivery = new LocalRedelivery(new SerialQueue(), nakDelayMs);
  }

  async connect(): Promise<void> {
    // The shared connection belongs to Long Tail's messaging registry.
  }

  async consume(handler: (event: EscalationEvent) => Promise<Disposition>): Promise<void> {
    this.sub = this.pubsub.subscribe(LT_SUBJECTS.ESCALATIONS, (m) => {
      let event: EscalationEvent | null = null;
      try { event = toEscalationEvent(JSON.parse(m.payload)); } catch { event = null; }
      if (event) void this.redelivery.deliver(() => handler(event!));
    });
  }

  async close(): Promise<void> {
    await this.sub?.close();
    await this.redelivery.stop();
  }
}
