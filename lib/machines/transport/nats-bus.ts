/**
 * The gateway on a NATS server of the site's own (MACHINE_SITE_NATS_*): the
 * stream bus on a NATS messaging provider this bus connects and closes itself.
 * With Long Tail's messaging configured, the stream bus runs on that instead.
 */

import type { MqttEndpoint } from '../../../services/machines/config';
import { NatsMessagingProvider } from '../../messaging/nats/provider';
import { StreamMachineBus } from './stream-bus';
import type { StreamCodec } from './streams';
import type { Disposition, InboundMessage, MachineBus } from './delivery';

export interface NatsBusOptions {
  natsUrl: string;
  user?: string;
  password?: string;
  mqtt: MqttEndpoint;
  /** The gateway's broker identity; also its MQTT client id. */
  controllerId: string;
  siteId: string;
  lineId: string;
  /** The codec's topics: which subjects are durable events and which are live telemetry. */
  codec: StreamCodec;
  nakDelayMs?: number;
}

export class NatsMachineBus implements MachineBus {
  private readonly provider: NatsMessagingProvider;
  private bus?: StreamMachineBus;

  constructor(private readonly opts: NatsBusOptions) {
    this.provider = new NatsMessagingProvider({ url: opts.natsUrl, user: opts.user, password: opts.password, name: opts.controllerId });
  }

  get durableName(): string {
    return `${this.opts.controllerId}-events`;
  }

  async connect(): Promise<void> {
    await this.provider.connect();
    const streams = this.provider.streams;
    if (!streams) throw new Error(`the site NATS at ${this.opts.natsUrl} has no JetStream for the gateway`);
    const { natsUrl: _url, user: _user, password: _password, ...rest } = this.opts;
    this.bus = new StreamMachineBus({ ...rest, streams, pubsub: this.provider.pubsub });
    await this.bus.connect();
  }

  consume(handler: (msg: InboundMessage) => Promise<Disposition>): Promise<void> {
    return this.stream().consume(handler);
  }

  publish(topic: string, payload: string, opts?: { retain?: boolean }): Promise<void> {
    return this.stream().publish(topic, payload, opts);
  }

  retained(filter: string): Promise<InboundMessage[]> {
    return this.stream().retained(filter);
  }

  async close(): Promise<void> {
    await this.bus?.close();
    await this.provider.disconnect();
  }

  private stream(): StreamMachineBus {
    if (!this.bus) throw new Error('NATS bus used before connect()');
    return this.bus;
  }
}
