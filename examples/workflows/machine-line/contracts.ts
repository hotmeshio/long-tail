/**
 * What the unit workflow and the machine gateway agree on: row types, roles,
 * the metadata a handoff row carries, error codes and resolution shapes. A
 * handoff row is the same for a machine resolver and a person; only the
 * protocol that resolves it differs.
 */

import { TRANSFER_FAILURE } from './protocol';

export const ROW_TYPE = {
  HANDOFF: 'handoff',
  HANDOFF_ERROR: 'handoff-error',
  ALARM: 'line-alarm',
  MACHINE_OFFLINE: 'machine-offline',
} as const;

export const LINE_ROLE = {
  /** People who clear alarms, bring machines back and decide failed handoffs. */
  OPERATOR: 'line-operator',
  /** People who take finished units off the line: the final handoff. */
  EXIT: 'line-exit',
  /** The gateway's own identity. */
  CONTROLLER: 'line-controller',
} as const;

/** Metadata on a handoff row. Everything a dispatch needs rides here. */
export interface HandoffFacets {
  unitId: string;
  jobId: string;
  carrierId: string | null;
  orderRef: string;
  fromMachine: string | null;
  toMachine: string | null;
  recipeId: string | null;
  recipeVersion: string | null;
  process: string | null;
  artifactUrl: string | null;
  artifactSha256: string | null;
  attempt: number;
}

/** The accumulated item that carries the sender's finished-job record. */
export const RELEASED_ITEM = 'released';

export const HANDOFF_ERROR = {
  DISPATCH_REFUSED: 'dispatch-refused',
  NO_REPLY: 'no-reply',
  SENDER_REJECTED: 'sender-rejected',
  HANDOFF_TIMEOUT: 'handoff-timeout',
  ...TRANSFER_FAILURE,
} as const;
export type HandoffErrorCode = typeof HANDOFF_ERROR[keyof typeof HANDOFF_ERROR];

/** What resolves a handoff row, from a machine or from a person's form. */
export interface HandoffResolution {
  received: boolean;
  receiver?: string;
  carrierId?: string | null;
  receivedAt?: string;
  errorCode?: HandoffErrorCode;
  reason?: string | null;
  detail?: string;
}

/** Decisions on line-operator rows: failed handoffs, alarms, dark machines. */
export const DECISION = {
  RETRY: 'retry',
  MANUAL: 'manual',
  SCRAP: 'scrap',
  ACKNOWLEDGE: 'acknowledge',
  CLEARED: 'cleared',
  RESTORED: 'restored',
} as const;
export type Decision = typeof DECISION[keyof typeof DECISION];

export interface OperatorResolution {
  decision: Decision;
  note?: string;
}

/** Signal keys for the unit workflow; every attempt mints a fresh key. */
export const signalKeys = {
  handoff: (unitId: string, step: number, attempt: number) => `handoff-${unitId}-s${step}-a${attempt}`,
  handoffError: (unitId: string, step: number, attempt: number) => `handoff-error-${unitId}-s${step}-a${attempt}`,
};

export const dispatchCommandId = (escalationId: string) => `${escalationId}:dispatch`;
export const cancelCommandId = (escalationId: string) => `${escalationId}:cancel`;
