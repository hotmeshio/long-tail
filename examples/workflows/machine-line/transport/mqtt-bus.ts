/**
 * The gateway over plain MQTT, for any broker. The persistent session keeps
 * QoS 1 messages while the gateway is away; there is no stream to replay
 * beyond that, and a message that is not yet actionable is retried in this
 * process.
 */

import type { MqttEndpoint } from '../config';
import { MqttSession } from './mqtt-session';
import { LocalRedelivery, SerialQueue } from './serial';
import type { Disposition, InboundMessage, MachineBus } from './types';

export class MqttMachineBus implements MachineBus {
  private session?: MqttSession;
  private readonly redelivery: LocalRedelivery;

  constructor(
    private readonly endpoint: MqttEndpoint,
    private readonly clientId: string,
    private readonly filter: string,
    nakDelayMs = 1_000,
  ) {
    this.redelivery = new LocalRedelivery(new SerialQueue(), nakDelayMs);
  }

  async connect(): Promise<void> {
    this.session = await MqttSession.open(this.endpoint, this.clientId);
  }

  async consume(handler: (msg: InboundMessage) => Promise<Disposition>): Promise<void> {
    await this.connected().subscribe(this.filter, (msg) => {
      void this.redelivery.deliver((deliveries) => handler({ ...msg, deliveries }));
    });
  }

  async publish(topic: string, payload: string, opts: { retain?: boolean } = {}): Promise<void> {
    await this.connected().publish(topic, payload, 1, opts.retain ?? false);
  }

  retained(filter: string): Promise<InboundMessage[]> {
    return this.connected().retained(filter);
  }

  async close(): Promise<void> {
    await this.redelivery.stop();
    await this.session?.close(true);
  }

  private connected(): MqttSession {
    if (!this.session) throw new Error('MQTT bus used before connect()');
    return this.session;
  }
}
