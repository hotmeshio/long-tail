/**
 * The site's durable log. Machine events, telemetry and Long Tail's
 * escalation events (arriving over the leafnode) each land in a JetStream
 * stream; the gateway reads events and escalations through durable
 * consumers, so a restart or a link outage replays instead of losing.
 */

import { AckPolicy, DeliverPolicy, nanos, StorageType, type ConsumerConfig, type JetStreamManager, type StreamConfig } from 'nats';

import { GENERIC_CHANNELS, type CodecChannels } from '../protocol/codec';

export const LINE_STREAM = {
  EVENTS: 'LINE_EVENTS',
  TELEMETRY: 'LINE_TELEMETRY',
  LT_EVENTS: 'LINE_LT_EVENTS',
} as const;

/** Long Tail publishes every LTEvent as `lt.events.<type>`. */
export const LT_ESCALATION_SUBJECTS = 'lt.events.system.escalation.>';

const DAY_MS = 86_400_000;
const ACK_WAIT_MS = 30_000;

type Scope = { root: string; siteId?: string; lineId?: string };

/** An MQTT filter as a NATS subject: levels become tokens, `+` becomes `*`, `#` becomes `>`. */
export function filterToSubject(filter: string): string {
  return filter.split('/').map((level) => (level === '+' ? '*' : level === '#' ? '>' : level)).join('.');
}

function subjectsFor({ root, siteId = '+', lineId = '+' }: Scope, channels: string[]): string[] {
  return channels.map((c) => filterToSubject(`${root}/${siteId}/${lineId}/+/${c}`));
}

/** Long Tail's escalation events, captured from the leafnode. */
export const LT_EVENTS_STREAM: Partial<StreamConfig> = {
  name: LINE_STREAM.LT_EVENTS, subjects: [LT_ESCALATION_SUBJECTS], max_age: nanos(7 * DAY_MS), storage: StorageType.File,
};

export function lineStreamConfigs(root: string, channels: CodecChannels = GENERIC_CHANNELS): Partial<StreamConfig>[] {
  return [
    { name: LINE_STREAM.EVENTS, subjects: subjectsFor({ root }, channels.events), max_age: nanos(30 * DAY_MS), storage: StorageType.File },
    { name: LINE_STREAM.TELEMETRY, subjects: subjectsFor({ root }, channels.telemetry), max_age: nanos(3 * DAY_MS), storage: StorageType.File },
    LT_EVENTS_STREAM,
  ];
}

/** The telemetry subjects for one line, read live rather than replayed. */
export function telemetrySubjects(root: string, siteId: string, lineId: string, channels: CodecChannels = GENERIC_CHANNELS): string[] {
  return subjectsFor({ root, siteId, lineId }, channels.telemetry);
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

export function lineEventConsumer(root: string, siteId: string, lineId: string, name: string, channels: CodecChannels = GENERIC_CHANNELS): Partial<ConsumerConfig> {
  return durableConsumer(name, subjectsFor({ root, siteId, lineId }, channels.events));
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
  try {
    await jsm.consumers.info(stream, config.durable_name!);
  } catch (err: any) {
    if (!/consumer not found/i.test(err?.message ?? '')) throw err;
    await jsm.consumers.add(stream, config);
  }
}
