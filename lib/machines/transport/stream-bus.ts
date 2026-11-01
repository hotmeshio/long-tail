/**
 * The gateway on Long Tail's messaging capability. Machine events come from the
 * line's durable consumer on LINE_EVENTS (replayed after a restart); telemetry
 * is read live, since it only proves a machine is alive. Commands leave through
 * an MQTT session at QoS 1 on the site broker, which queues them for a machine
 * that is away; retained machine state is read there too. The streams are
 * ensured with every codec on the site, so lines on different roots share
 * them, and a consumer the stream would feed nothing refuses to start.
 */

import type { LTPubSub, LTStreams, LTSubscription } from '../../../types/messaging';
import type { MqttEndpoint } from '../../../services/machines/config';
import { toTopic } from '../protocol';
import { MqttSession } from './mqtt-session';
import { SerialQueue } from './serial';
import { LINE_STREAM, lineEventConsumerSpec, lineStreamSpecs, telemetrySubjects, uncoveredSubjects, type StreamCodec } from './streams';
import type { Disposition, InboundMessage, MachineBus } from './delivery';

export interface StreamBusOptions {
  streams: LTStreams;
  pubsub: LTPubSub;
  mqtt: MqttEndpoint;
  /** The gateway's broker identity; also its MQTT client id and the root of its consumer's name. */
  controllerId: string;
  siteId: string;
  lineId: string;
  /** The codec's topics: which subjects are durable events and which are live telemetry. */
  codec: StreamCodec;
  /** The codecs of every line on this site; the streams keep all their subjects, whichever line starts last. */
  siteCodecs?: StreamCodec[];
  nakDelayMs?: number;
}

export class StreamMachineBus implements MachineBus {
  private session?: MqttSession;
  private subs: LTSubscription[] = [];
  /** Events and telemetry reach the gateway one at a time, in arrival order. */
  private readonly queue = new SerialQueue();

  constructor(private readonly opts: StreamBusOptions) {}

  get durableName(): string {
    return `${this.opts.controllerId}-events`;
  }

  async connect(): Promise<void> {
    const { streams, codec, siteId, lineId, controllerId, siteCodecs = [] } = this.opts;
    for (const spec of lineStreamSpecs([codec, ...siteCodecs])) await streams.ensureStream(spec);
    const consumer = lineEventConsumerSpec(codec, siteId, lineId, this.durableName);
    await streams.ensureConsumer(LINE_STREAM.EVENTS, consumer);
    const events = await streams.describeStream(LINE_STREAM.EVENTS);
    const missing = events ? uncoveredSubjects(events, consumer.filterSubjects) : consumer.filterSubjects;
    if (missing.length) {
      throw new Error(`${LINE_STREAM.EVENTS} keeps nothing of ${missing.join(', ')}; the stream holds ${events?.subjects.join(', ') ?? 'nothing'}`);
    }
    this.session = await MqttSession.open(this.opts.mqtt, controllerId);
  }

  async consume(handler: (msg: InboundMessage) => Promise<Disposition>): Promise<void> {
    const { streams, pubsub, codec, siteId, lineId, nakDelayMs = 1_000 } = this.opts;
    this.subs.push(await streams.consume(LINE_STREAM.EVENTS, this.durableName, (m) =>
      this.queue.run(() => handler({ topic: toTopic(m.subject), payload: m.payload, deliveries: m.deliveries })), { nakDelayMs }));
    for (const subject of telemetrySubjects(codec, siteId, lineId)) {
      this.subs.push(pubsub.subscribe(subject, (m) =>
        void this.queue.run(() => handler({ topic: toTopic(m.subject), payload: m.payload, deliveries: 1 }))));
    }
  }

  async publish(topic: string, payload: string, opts: { retain?: boolean } = {}): Promise<void> {
    await this.mqtt().publish(topic, payload, 1, opts.retain ?? false);
  }

  retained(filter: string): Promise<InboundMessage[]> {
    return this.mqtt().retained(filter);
  }

  /** Stops the consumer and the live subscriptions; the MQTT session stays open for commands and receipts. */
  async unsubscribe(): Promise<void> {
    for (const sub of this.subs.splice(0)) await sub.close();
    await this.queue.drained();
  }

  async close(): Promise<void> {
    await this.unsubscribe();
    await this.session?.close(true);
  }

  private mqtt(): MqttSession {
    if (!this.session) throw new Error('stream bus used before connect()');
    return this.session;
  }
}
