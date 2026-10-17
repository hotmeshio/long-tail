/**
 * Topic builders and the parser that classifies an inbound topic. NATS
 * carries an MQTT topic on the subject with `/` replaced by `.`, so no topic
 * level may contain `.`, `/`, `+`, `#` or whitespace.
 */

import { CHANNEL } from './constants';
import type { MachineIdent } from './envelope';

export const MESSAGE_KIND = {
  PRESENCE: 'presence',
  SNAPSHOT: 'snapshot',
  JOB: 'job',
  ALARM: 'alarm',
  TELEMETRY: 'telemetry',
  CMD: 'cmd',
  REPLY: 'reply',
  REPORT: 'report',
} as const;
export type MessageKind = typeof MESSAGE_KIND[keyof typeof MESSAGE_KIND];

export interface ParsedTopic {
  ident: MachineIdent;
  kind: MessageKind;
  /** The alarm id on alarm topics; the report name on report topics. */
  key?: string;
}

const RESERVED = /[/+#.\s]/;

export function assertTopicLevel(name: string, value: string): void {
  if (!value || RESERVED.test(value)) {
    throw new Error(`${name} "${value}" is not a valid topic level (no / + # . or whitespace)`);
  }
}

export function machineTopic(root: string, ident: MachineIdent, channel: string): string {
  return `${root}/${ident.siteId}/${ident.lineId}/${ident.machineId}/${channel}`;
}

export function alarmTopic(root: string, ident: MachineIdent, alarmId: string): string {
  return machineTopic(root, ident, `${CHANNEL.ALARM}/${alarmId}`);
}

/** Every topic on one line, for a controller subscription. */
export function lineFilter(root: string, siteId: string, lineId: string): string {
  return `${root}/${siteId}/${lineId}/#`;
}

export function toSubject(topic: string): string {
  return topic.split('/').join('.');
}

export function toTopic(subject: string): string {
  return subject.split('.').join('/');
}

const CHANNEL_KIND: Record<string, MessageKind> = {
  [CHANNEL.PRESENCE]: MESSAGE_KIND.PRESENCE,
  [CHANNEL.SNAPSHOT]: MESSAGE_KIND.SNAPSHOT,
  [CHANNEL.JOB]: MESSAGE_KIND.JOB,
  [CHANNEL.TELEMETRY]: MESSAGE_KIND.TELEMETRY,
  [CHANNEL.CMD]: MESSAGE_KIND.CMD,
  [CHANNEL.REPLY]: MESSAGE_KIND.REPLY,
};

/** Classify a topic under `root`; null when it is not a machine topic. */
export function parseTopic(root: string, topic: string): ParsedTopic | null {
  const prefix = `${root}/`;
  if (!topic.startsWith(prefix)) return null;
  const [siteId, lineId, machineId, ...rest] = topic.slice(prefix.length).split('/');
  if (!siteId || !lineId || !machineId || rest.length === 0) return null;
  const ident = { siteId, lineId, machineId };
  const kind = CHANNEL_KIND[rest.join('/')];
  if (kind) return { ident, kind };
  if (rest.length === 2 && rest[0] === CHANNEL.ALARM) return { ident, kind: MESSAGE_KIND.ALARM, key: rest[1] };
  if (rest.length >= 2 && rest[0] === CHANNEL.REPORT) return { ident, kind: MESSAGE_KIND.REPORT, key: rest.slice(1).join('/') };
  return null;
}
