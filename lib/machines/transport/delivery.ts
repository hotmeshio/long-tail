/**
 * Two sides of the machine fabric. A machine holds a MachineLink: one MQTT
 * client with a will, publishing under its own subtree and hearing only its
 * own commands. The gateway holds a MachineBus: durable, ordered delivery of
 * every machine message on the line, QoS 1 command egress, and retained reads.
 */

import type {
  EscalationEvent, EscalationFeed, InboundMessage, LinkConnectOptions, LinkWill, MachineBus, MachineLink, PublishOptions,
} from '../../../types/machines';

export type { EscalationEvent, EscalationFeed, InboundMessage, LinkConnectOptions, LinkWill, MachineBus, MachineLink, PublishOptions };
export const DISPOSITION = {
  /** Handled; do not deliver again. */
  ACK: 'ack',
  /** Not yet actionable (its row does not exist yet); deliver again later. */
  NAK: 'nak',
  /** Never actionable; drop it. */
  TERM: 'term',
} as const;
export type Disposition = typeof DISPOSITION[keyof typeof DISPOSITION];

/** MQTT filter match with `+` (one level) and `#` (the rest). */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

const ESCALATION_SUBJECT = /^(?:.*\.)?system\.escalation\.([^.]+)\.([^.]+)\.([^.]+)$/;

/** Read an LTEvent body into an EscalationEvent; null for other families. */
export function toEscalationEvent(body: Record<string, any>): EscalationEvent | null {
  const match = typeof body?.type === 'string' ? ESCALATION_SUBJECT.exec(body.type) : null;
  if (!match) return null;
  const [, role, escalationId, verb] = match;
  return { type: body.type, escalationId: body.escalationId ?? escalationId, role: body.role ?? role, verb, data: body.data ?? {} };
}
