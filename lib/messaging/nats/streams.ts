/**
 * Durable streams on JetStream. A spec becomes a file-backed stream or an
 * explicit-ack durable consumer; ensuring either is safe on every boot and
 * from several lines at once. An existing consumer keeps its position while
 * its subjects match the spec; one whose subjects changed is made again, since
 * a position in another protocol's messages means nothing to this one.
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
/** Consumer events after which the consumer delivers nothing more: its stream or itself is gone, or the server fell silent. */
const CONSUMER_LOST = new Set<string>(['consumer_deleted', 'consumer_not_found', 'stream_not_found', 'heartbeats_missed']);

const sameSubjects = (a: string[] = [], b: string[] = []): boolean => [...a].sort().join('|') === [...b].sort().join('|');

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

/**
 * Create the stream, or update an existing one to the spec. Two lines may
 * ensure the same stream at once: the create that loses the race finds the
 * stream in use and updates it instead.
 */
export async function ensureStream(jsm: JetStreamManager, spec: StreamSpec): Promise<void> {
  const config = streamConfig(spec);
  try {
    await jsm.streams.info(spec.name);
  } catch (err: any) {
    if (!/stream not found/i.test(err?.message ?? '')) throw err;
    try {
      await jsm.streams.add(config);
      return;
    } catch (added: any) {
      if (!/already in use/i.test(added?.message ?? '')) throw added;
    }
  }
  await jsm.streams.update(spec.name, config);
}

/** The stream as JetStream holds it, or null when there is none. */
export async function describeStream(jsm: JetStreamManager, name: string): Promise<StreamSpec | null> {
  try {
    const info = await jsm.streams.info(name);
    return { name, subjects: info.config.subjects ?? [], maxAgeMs: Math.round((info.config.max_age ?? 0) / 1_000_000) };
  } catch (err: any) {
    if (/stream not found/i.test(err?.message ?? '')) return null;
    throw err;
  }
}

/**
 * Create the consumer, or keep an existing one whose subjects match the spec,
 * position and all. One whose subjects differ is deleted and made again at
 * the stream's newest message, since its old position was in another
 * protocol's messages.
 */
export async function ensureConsumer(jsm: JetStreamManager, stream: string, spec: ConsumerSpec): Promise<void> {
  let existing;
  try {
    existing = await jsm.consumers.info(stream, spec.name);
  } catch (err: any) {
    if (!/consumer not found/i.test(err?.message ?? '')) throw err;
    await jsm.consumers.add(stream, consumerConfig(spec));
    return;
  }
  if (sameSubjects(spec.filterSubjects, existing.config.filter_subjects)) return;
  await jsm.consumers.delete(stream, spec.name);
  await jsm.consumers.add(stream, consumerConfig(spec));
}

/** The consumer as JetStream holds it, or null when there is none. */
export async function describeConsumer(jsm: JetStreamManager, stream: string, name: string): Promise<ConsumerSpec | null> {
  try {
    const info = await jsm.consumers.info(stream, name);
    return { name, filterSubjects: info.config.filter_subjects ?? (info.config.filter_subject ? [info.config.filter_subject] : []) };
  } catch (err: any) {
    if (/consumer not found|stream not found/i.test(err?.message ?? '')) return null;
    throw err;
  }
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

  describeStream(name: string): Promise<StreamSpec | null> {
    return describeStream(this.jsm, name);
  }

  describeConsumer(stream: string, name: string): Promise<ConsumerSpec | null> {
    return describeConsumer(this.jsm, stream, name);
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
    // The consumer's own status: once its stream or itself is gone, or the server fell silent, the reader is told.
    void (async () => {
      for await (const status of await messages.status()) {
        if (!CONSUMER_LOST.has(String(status.type))) continue;
        opts.onLost?.(String(status.type));
        return;
      }
    })().catch(() => {});
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
