/**
 * Durable streams on JetStream. A spec becomes a file-backed stream or an
 * explicit-ack durable consumer; ensuring either is safe on every boot, and an
 * existing consumer keeps its position while its subjects follow the spec.
 */

import {
  AckPolicy, DeliverPolicy, nanos, StorageType,
  type ConsumerConfig, type JetStreamClient, type JetStreamManager, type StreamConfig,
} from 'nats';

import type {
  ConsumerSpec, Delivery, LTConsumeOptions, LTStreamMessage, LTStreams, LTSubscription, StreamSpec, Subject,
} from '../../../types/messaging';
import { DELIVERY, START_AT } from '../constants';

const DEFAULT_ACK_WAIT_MS = 30_000;
const DEFAULT_NAK_DELAY_MS = 1_000;

export function streamConfig(spec: StreamSpec): Partial<StreamConfig> {
  return { name: spec.name, subjects: spec.subjects, max_age: nanos(spec.maxAgeMs), storage: StorageType.File };
}

export function consumerConfig(spec: ConsumerSpec): Partial<ConsumerConfig> {
  return {
    durable_name: spec.name,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: (spec.startAt ?? START_AT.NEW) === START_AT.ALL ? DeliverPolicy.All : DeliverPolicy.New,
    ack_wait: nanos(spec.ackWaitMs ?? DEFAULT_ACK_WAIT_MS),
    filter_subjects: spec.filterSubjects,
  };
}

/** Create the stream, or update an existing one to the spec. */
export async function ensureStream(jsm: JetStreamManager, spec: StreamSpec): Promise<void> {
  const config = streamConfig(spec);
  try {
    await jsm.streams.info(spec.name);
  } catch (err: any) {
    if (!/stream not found/i.test(err?.message ?? '')) throw err;
    await jsm.streams.add(config);
    return;
  }
  await jsm.streams.update(spec.name, config);
}

/** Create the consumer, or move an existing one to the spec's subjects without losing its place. */
export async function ensureConsumer(jsm: JetStreamManager, stream: string, spec: ConsumerSpec): Promise<void> {
  let existing;
  try {
    existing = await jsm.consumers.info(stream, spec.name);
  } catch (err: any) {
    if (!/consumer not found/i.test(err?.message ?? '')) throw err;
    await jsm.consumers.add(stream, consumerConfig(spec));
    return;
  }
  const want = [...spec.filterSubjects].sort();
  const have = [...(existing.config.filter_subjects ?? [])].sort();
  if (want.join('|') !== have.join('|')) await jsm.consumers.update(stream, spec.name, { filter_subjects: spec.filterSubjects });
}

export function payloadOf(m: { data: Uint8Array }): string {
  return Buffer.from(m.data).toString('utf8');
}

export class NatsStreams implements LTStreams {
  constructor(private readonly jsm: JetStreamManager, private readonly js: JetStreamClient) {}

  ensureStream(spec: StreamSpec): Promise<void> {
    return ensureStream(this.jsm, spec);
  }

  ensureConsumer(stream: string, spec: ConsumerSpec): Promise<void> {
    return ensureConsumer(this.jsm, stream, spec);
  }

  async append(subject: Subject, payload: string): Promise<void> {
    await this.js.publish(subject, payload);
  }

  /** One message at a time: the next is not taken until the handler settles this one. */
  async consume(
    stream: string, consumer: string, handler: (m: LTStreamMessage) => Promise<Delivery>, opts: LTConsumeOptions = {},
  ): Promise<LTSubscription> {
    const nakDelayMs = opts.nakDelayMs ?? DEFAULT_NAK_DELAY_MS;
    const messages = await (await this.js.consumers.get(stream, consumer)).consume();
    void (async () => {
      for await (const m of messages) {
        const delivery = await handler({ subject: m.subject, payload: payloadOf(m), deliveries: m.info.deliveryCount })
          .catch(() => DELIVERY.NAK);
        if (delivery === DELIVERY.ACK) m.ack();
        else if (delivery === DELIVERY.NAK) m.nak(nakDelayMs);
        else m.term();
      }
    })();
    return { close: async () => { await messages.close(); } };
  }
}
