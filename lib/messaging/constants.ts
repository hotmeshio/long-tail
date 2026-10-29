/** Deliveries, log events and subjects for the messaging capability. */

import type { Delivery, StartAt } from '../../types/messaging';

/** What a consumer does with a stream message. */
export const DELIVERY = {
  /** Handled; do not deliver again. */
  ACK: 'ack',
  /** Not yet actionable; deliver again after a delay. */
  NAK: 'nak',
  /** Never actionable; drop it. */
  TERM: 'term',
} as const satisfies Record<string, Delivery>;

/** Where a new consumer starts: only messages appended after it, or the whole retained history. */
export const START_AT = { NEW: 'new', ALL: 'all' } as const satisfies Record<string, StartAt>;

export const MESSAGING_LOG = {
  CONNECTED: 'messaging.provider.connected',
  DISCONNECTED: 'messaging.provider.disconnected',
  CONNECT_FAILED: 'messaging.provider.connect_failed',
} as const;

/** Subjects Long Tail itself publishes under. */
export const LT_SUBJECTS = {
  EVENTS: 'lt.events',
  ESCALATIONS: 'lt.events.system.escalation.>',
} as const;
