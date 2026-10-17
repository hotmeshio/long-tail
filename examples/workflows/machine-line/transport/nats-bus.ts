/**
 * The gateway on the site NATS. Machine events come from the line's durable
 * consumer on LINE_EVENTS (replayed after a restart); telemetry is read live,
 * since it only proves a machine is alive. Commands leave through an MQTT
 * session at QoS 1: a NATS publish reaches MQTT subscribers at QoS 0 and
 * would not wait for a machine that is away.
 */

import { connect, type ConsumerMessages, type NatsConnection, type Subscription } from 'nats';

import type { MqttEndpoint } from '../config';
import { toTopic } from '../protocol';
import { MqttSession } from './mqtt-session';
import { payloadOf, readDurable } from './nats-durable';
import { SerialQueue } from './serial';
import { LINE_STREAM, ensureConsumer, ensureStreams, lineEventConsumer, lineStreamConfigs, telemetrySubject } from './streams';
import type { Disposition, InboundMessage, MachineBus } from './types';

export interface NatsBusOptions {
  natsUrl: string;
  user?: string;
  password?: string;
  mqtt: MqttEndpoint;
  /** The gateway's broker identity; also its MQTT client id. */
  controllerId: string;
  root: string;
  siteId: string;
  lineId: string;
  nakDelayMs?: number;
}

export class NatsMachineBus implements MachineBus {
  private nc?: NatsConnection;
  private session?: MqttSession;
  private messages?: ConsumerMessages;
  private telemetry?: Subscription;
  private readonly queue = new SerialQueue();

  constructor(private readonly opts: NatsBusOptions) {}

  get durableName(): string {
    return `${this.opts.controllerId}-events`;
  }

  async connect(): Promise<void> {
    const { natsUrl, user, password, controllerId, root, siteId, lineId } = this.opts;
    this.nc = await connect({ servers: natsUrl, user, pass: password, name: controllerId });
    const jsm = await this.nc.jetstreamManager();
    await ensureStreams(jsm, lineStreamConfigs(root));
    await ensureConsumer(jsm, LINE_STREAM.EVENTS, lineEventConsumer(root, siteId, lineId, this.durableName));
    this.session = await MqttSession.open(this.opts.mqtt, controllerId);
  }

  async consume(handler: (msg: InboundMessage) => Promise<Disposition>): Promise<void> {
    const nc = this.nats();
    const { root, siteId, lineId, nakDelayMs = 1_000 } = this.opts;
    this.messages = await readDurable(nc.jetstream(), LINE_STREAM.EVENTS, this.durableName, this.queue, (m) =>
      handler({ topic: toTopic(m.subject), payload: payloadOf(m), deliveries: m.info.deliveryCount }), nakDelayMs);
    this.telemetry = nc.subscribe(telemetrySubject(root, siteId, lineId), {
      callback: (_err, m) => void this.queue.run(() => handler({ topic: toTopic(m.subject), payload: payloadOf(m), deliveries: 1 })),
    });
  }

  async publish(topic: string, payload: string, opts: { retain?: boolean } = {}): Promise<void> {
    await this.mqtt().publish(topic, payload, 1, opts.retain ?? false);
  }

  retained(filter: string): Promise<InboundMessage[]> {
    return this.mqtt().retained(filter);
  }

  async close(): Promise<void> {
    this.telemetry?.unsubscribe();
    await this.messages?.close();
    await this.queue.drained();
    await this.session?.close(true);
    await this.nc?.drain();
  }

  private nats(): NatsConnection {
    if (!this.nc) throw new Error('NATS bus used before connect()');
    return this.nc;
  }

  private mqtt(): MqttSession {
    if (!this.session) throw new Error('NATS bus used before connect()');
    return this.session;
  }
}
