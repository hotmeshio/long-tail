/**
 * Two sides of the machine fabric. A machine holds a MachineLink: one MQTT
 * client with a will, publishing under its own subtree and hearing only its
 * own commands. The gateway holds a MachineBus: durable, ordered delivery of
 * every machine message on the line, QoS 1 command egress, and retained reads.
 */

import { DELIVERY } from '../../messaging/constants';
import type { Delivery } from '../../../types/messaging';
import type {
  EscalationEvent, EscalationFeed, InboundMessage, LinkConnectOptions, LinkWill, MachineBus, MachineLink, PublishOptions,
} from '../../../types/machines';

export type { EscalationEvent, EscalationFeed, InboundMessage, LinkConnectOptions, LinkWill, MachineBus, MachineLink, PublishOptions };
/** What the gateway does with a machine message: the messaging capability's deliveries (nak: its row does not exist yet). */
export const DISPOSITION = DELIVERY;
export type Disposition = Delivery;

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
