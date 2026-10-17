/**
 * The machine side over MQTT: one persistent session per machine, logged in
 * with its own credentials, with a will that marks it offline.
 */

import type { MqttEndpoint } from '../../../services/machines/config';
import { MqttSession } from './mqtt-session';
import type { InboundMessage, LinkConnectOptions, MachineLink, PublishOptions } from './delivery';

export class MqttMachineLink implements MachineLink {
  private session?: MqttSession;

  constructor(private readonly endpoint: MqttEndpoint) {}

  get connected(): boolean {
    return !!this.session?.connected;
  }

  async connect(opts: LinkConnectOptions): Promise<void> {
    if (this.session) await this.session.close(false);
    this.session = await MqttSession.open(this.endpoint, opts.clientId, { will: opts.will, onRestored: opts.onRestored });
  }

  async publish(topic: string, payload: string, opts: PublishOptions): Promise<void> {
    if (!this.session) throw new Error(`publish before connect: ${topic}`);
    await this.session.publish(topic, payload, opts.qos, opts.retain ?? false);
  }

  async subscribe(filter: string, handler: (msg: InboundMessage) => void): Promise<void> {
    if (!this.session) throw new Error('subscribe before connect');
    await this.session.subscribe(filter, handler);
  }

  async disconnect(graceful: boolean): Promise<void> {
    const session = this.session;
    this.session = undefined;
    await session?.close(graceful);
  }
}
