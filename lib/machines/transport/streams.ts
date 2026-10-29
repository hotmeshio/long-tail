/**
 * The line's durable log, as specs for the messaging capability. Machine
 * events and telemetry each land in a stream; the gateway reads events through
 * a durable consumer, so a restart or a link outage replays instead of losing.
 */

import type { ConsumerSpec, StreamSpec } from '../../../types/messaging';
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
const codecOf = (codec: StreamCodec | string): StreamCodec => (typeof codec === 'string' ? GENERIC(codec) : codec);

/** An MQTT filter as a subject: levels become tokens, `+` becomes `*`, `#` becomes `>`. */
export function filterToSubject(filter: string): string {
  return filter.split('/').map((level) => (level === '+' ? '*' : level === '#' ? '>' : level)).join('.');
}

function subjectsFor(codec: StreamCodec, channels: string[], siteId?: string, lineId?: string): string[] {
  return channels.map((c) => filterToSubject(topicOf(codec, { siteId, lineId }, c)));
}

/** The line streams, for every line under the codec's root; a root alone means the generic layout. */
export function lineStreamSpecs(codec: StreamCodec | string): StreamSpec[] {
  const c = codecOf(codec);
  return [
    { name: LINE_STREAM.EVENTS, subjects: subjectsFor(c, c.channels.events), maxAgeMs: 30 * DAY_MS },
    { name: LINE_STREAM.TELEMETRY, subjects: subjectsFor(c, c.channels.telemetry), maxAgeMs: 3 * DAY_MS },
  ];
}

/** The telemetry subjects for one line, read live rather than replayed. */
export function telemetrySubjects(codec: StreamCodec | string, siteId: string, lineId: string): string[] {
  const c = codecOf(codec);
  return subjectsFor(c, c.channels.telemetry, siteId, lineId);
}

/**
 * One line's event consumer. It starts at new messages the first time (open
 * rows are reconciled at boot); after that its position survives restarts.
 */
export function lineEventConsumerSpec(codec: StreamCodec | string, siteId: string, lineId: string, name: string): ConsumerSpec {
  const c = codecOf(codec);
  return { name, filterSubjects: subjectsFor(c, c.channels.events, siteId, lineId), ackWaitMs: ACK_WAIT_MS, startAt: 'new' };
}
