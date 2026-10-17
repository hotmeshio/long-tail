/**
 * Memory adapters over one MemoryBroker: a MachineLink per mock machine, the
 * gateway's MachineBus, and an EscalationFeed that tests publish into the
 * way Long Tail publishes escalation events.
 */

import { MemoryBroker } from './memory-broker';
import {
  DISPOSITION, toEscalationEvent,
  type Disposition, type EscalationEvent, type EscalationFeed, type InboundMessage,
  type LinkConnectOptions, type MachineBus, type MachineLink, type PublishOptions,
} from './types';

export class MemoryMachineLink implements MachineLink {
  private clientId?: string;

  constructor(private readonly broker: MemoryBroker) {}

  get connected(): boolean {
    return !!this.clientId && this.broker.isConnected(this.clientId);
  }

  async connect(opts: LinkConnectOptions): Promise<void> {
    this.clientId = opts.clientId;
    this.broker.connect(opts.clientId, opts.will);
  }

  async publish(topic: string, payload: string, opts: PublishOptions): Promise<void> {
    if (!this.connected) throw new Error(`publish while disconnected: ${topic}`);
    this.broker.publish(topic, payload, opts.retain ?? false);
  }

  async subscribe(filter: string, handler: (msg: InboundMessage) => void): Promise<void> {
    if (!this.clientId) throw new Error('subscribe before connect');
    this.broker.subscribe(this.clientId, filter, handler);
  }

  async disconnect(graceful: boolean): Promise<void> {
    if (this.clientId) this.broker.disconnect(this.clientId, graceful);
  }
}

export class MemoryMachineBus implements MachineBus {
  constructor(
    private readonly broker: MemoryBroker,
    private readonly filter: string,
    private readonly durableName = 'line-gateway',
  ) {}

  async connect(): Promise<void> {}

  async consume(handler: (msg: InboundMessage) => Promise<Disposition>): Promise<void> {
    this.broker.consume(this.durableName, this.filter, handler);
  }

  async publish(topic: string, payload: string, opts: { retain?: boolean } = {}): Promise<void> {
    this.broker.publish(topic, payload, opts.retain ?? false);
  }

  async retained(filter: string): Promise<InboundMessage[]> {
    return this.broker.retained(filter);
  }

  async close(): Promise<void> {
    this.broker.detach(this.durableName);
  }
}

const FEED_TOPIC = 'lt/events';

export class MemoryEscalationFeed implements EscalationFeed {
  constructor(private readonly broker: MemoryBroker, private readonly durableName = 'line-gateway-escalations') {}

  /** Publish an LTEvent body as Long Tail would. */
  emit(body: Record<string, any>): void {
    this.broker.publish(FEED_TOPIC, JSON.stringify(body));
  }

  async connect(): Promise<void> {}

  async consume(handler: (event: EscalationEvent) => Promise<Disposition>): Promise<void> {
    this.broker.consume(this.durableName, FEED_TOPIC, async (msg) => {
      const event = toEscalationEvent(JSON.parse(msg.payload));
      return event ? handler(event) : DISPOSITION.TERM;
    });
  }

  async close(): Promise<void> {
    this.broker.detach(this.durableName);
  }
}
