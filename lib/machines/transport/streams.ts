/**
 * The site's durable log. Machine events and telemetry each land in a
 * JetStream stream; the gateway reads events through a durable consumer, so
 * a restart or a link outage replays instead of losing.
 */

import { AckPolicy, DeliverPolicy, nanos, StorageType, type ConsumerConfig, type JetStreamManager, type StreamConfig } from 'nats';

import { GENERIC_CHANNELS, topicOf, type LineCodec } from '../protocol/codec';

export const LINE_STREAM = {
  EVENTS: 'LINE_EVENTS',
  TELEMETRY: 'LINE_TELEMETRY',
} as const;

const DAY_MS = 86_400_000;
const ACK_WAIT_MS = 30_000;

/** What the streams need from a codec: its root, channels and topic layout. */
export type StreamCodec = Pick<LineCodec, 'root' | 'channels' | 'topicFor'>;

const GENERIC = (root: string): StreamCodec => ({ root, channels: GENERIC_CHANNELS });

/** An MQTT filter as a NATS subject: levels become tokens, `+` becomes `*`, `#` becomes `>`. */
export function filterToSubject(filter: string): string {
  return filter.split('/').map((level) => (level === '+' ? '*' : level === '#' ? '>' : level)).join('.');
}

function subjectsFor(codec: StreamCodec, channels: string[], siteId?: string, lineId?: string): string[] {
  return channels.map((c) => filterToSubject(topicOf(codec, { siteId, lineId }, c)));
}

/** The site's streams, for every line under the codec's root; a root alone means the generic layout. */
export function lineStreamConfigs(codec: StreamCodec | string): Partial<StreamConfig>[] {
  const c = typeof codec === 'string' ? GENERIC(codec) : codec;
  return [
    { name: LINE_STREAM.EVENTS, subjects: subjectsFor(c, c.channels.events), max_age: nanos(30 * DAY_MS), storage: StorageType.File },
    { name: LINE_STREAM.TELEMETRY, subjects: subjectsFor(c, c.channels.telemetry), max_age: nanos(3 * DAY_MS), storage: StorageType.File },
  ];
}

/** The telemetry subjects for one line, read live rather than replayed. */
export function telemetrySubjects(codec: StreamCodec | string, siteId: string, lineId: string): string[] {
  const c = typeof codec === 'string' ? GENERIC(codec) : codec;
  return subjectsFor(c, c.channels.telemetry, siteId, lineId);
}

/**
 * A durable consumer. It starts at new messages the first time (open rows
 * are reconciled at boot); after that its position survives restarts.
 */
export function durableConsumer(name: string, filterSubjects: string[]): Partial<ConsumerConfig> {
  return {
    durable_name: name,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.New,
    ack_wait: nanos(ACK_WAIT_MS),
    filter_subjects: filterSubjects,
  };
}

export function lineEventConsumer(codec: StreamCodec | string, siteId: string, lineId: string, name: string): Partial<ConsumerConfig> {
  const c = typeof codec === 'string' ? GENERIC(codec) : codec;
  return durableConsumer(name, subjectsFor(c, c.channels.events, siteId, lineId));
}

/** Create or update each stream, then the consumer. Safe on every boot. */
export async function ensureStreams(jsm: JetStreamManager, streams: Partial<StreamConfig>[]): Promise<void> {
  for (const config of streams) {
    try {
      await jsm.streams.info(config.name!);
      await jsm.streams.update(config.name!, config);
    } catch (err: any) {
      if (!/stream not found/i.test(err?.message ?? '')) throw err;
      await jsm.streams.add(config);
    }
  }
}

export async function ensureConsumer(jsm: JetStreamManager, stream: string, config: Partial<ConsumerConfig>): Promise<void> {
  let existing;
  try {
    existing = await jsm.consumers.info(stream, config.durable_name!);
  } catch (err: any) {
    if (!/consumer not found/i.test(err?.message ?? '')) throw err;
    await jsm.consumers.add(stream, config);
    return;
  }
  // The consumer keeps its position; only its subjects follow the codec's channels.
  const want = [...(config.filter_subjects ?? [])].sort();
  const have = [...(existing.config.filter_subjects ?? [])].sort();
  if (want.join('|') !== have.join('|')) await jsm.consumers.update(stream, config.durable_name!, { filter_subjects: config.filter_subjects });
}
