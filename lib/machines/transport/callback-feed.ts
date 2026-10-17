/**
 * Escalation events from Long Tail's in-process event adapter. With a
 * cross-container bus configured, the adapter also receives events other
 * containers publish. Nothing is replayed: the gateway reconciles open rows
 * when it starts leading a line.
 */

import type { CallbackEventAdapter } from '../../events/callback';
import { toEscalationEvent, type EscalationEvent, type EscalationFeed } from './delivery';
import { LocalRedelivery, SerialQueue } from './serial';
import type { MachineDisposition } from '../../../types/machines';

const ESCALATION_EVENTS = 'system.escalation.>';

export class CallbackEscalationFeed implements EscalationFeed {
  private off?: () => void;
  private readonly redelivery: LocalRedelivery;

  constructor(private readonly adapter: CallbackEventAdapter, nakDelayMs = 1_000) {
    this.redelivery = new LocalRedelivery(new SerialQueue(), nakDelayMs);
  }

  async connect(): Promise<void> {}

  async consume(handler: (event: EscalationEvent) => Promise<MachineDisposition>): Promise<void> {
    this.off = this.adapter.on(ESCALATION_EVENTS, (raw) => {
      const event = toEscalationEvent(raw as unknown as Record<string, any>);
      if (event) void this.redelivery.deliver(() => handler(event));
    });
  }

  async close(): Promise<void> {
    this.off?.();
    await this.redelivery.stop();
  }
}
