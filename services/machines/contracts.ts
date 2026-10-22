/**
 * What the unit workflow and the machine gateway agree on: row types, roles,
 * the metadata a handoff row carries, error codes and resolution shapes. A
 * handoff row is the same for a machine resolver and a person; only the
 * protocol that resolves it differs.
 */

import { DEFAULT_EXIT_ROLE, DEFAULT_OPERATOR_ROLE } from '../../lib/machines/line';
import { REPLY_STATUS, TRANSFER_FAILURE } from '../../lib/machines/protocol';

export const ROW_TYPE = {
  HANDOFF: 'handoff',
  HANDOFF_ERROR: 'handoff-error',
  ALARM: 'line-alarm',
  MACHINE_OFFLINE: 'machine-offline',
  MACHINE_QUIET: 'machine-quiet',
  /** A host asks a machine to start, stop, pause, resume or change over. */
  MACHINE_COMMAND: 'machine-command',
} as const;

export const LINE_ROLE = {
  /** People who clear alarms, bring machines back and decide failed handoffs. */
  OPERATOR: DEFAULT_OPERATOR_ROLE,
  /** People who take finished units off the line: the final handoff. */
  EXIT: DEFAULT_EXIT_ROLE,
  /** The gateway's own identity. */
  CONTROLLER: 'line-controller',
} as const;

export interface HandoffUnit {
  unitId: string;
  carrierId: string | null;
}

/** Metadata on a handoff row. Everything a dispatch needs rides here. */
export interface HandoffFacets {
  /** The line the row belongs to; a gateway acts only on its own line's rows. */
  siteId: string;
  lineId: string;
  /** The units that move together as one job. */
  units: HandoffUnit[];
  /** The receiver's job for these units. */
  jobId: string;
  /** The sender's job for these units; cancelled with the row. */
  senderJobId: string | null;
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

/**
 * Items a handoff row accumulates, one per unit: the sender's finished-job
 * record, and the receiver's arrival. When every unit's arrival is held, the
 * receiver resolves the row.
 */
export const itemKeys = {
  released: (unitId: string) => `released:${unitId}`,
  arrived: (unitId: string) => `arrived:${unitId}`,
};

export const HANDOFF_ERROR = {
  DISPATCH_REFUSED: 'dispatch-refused',
  /** Accepted, then the machine could not prepare the job (artifact, recipe). */
  DISPATCH_FAILED: 'dispatch-failed',
  NO_REPLY: 'no-reply',
  SENDER_REJECTED: 'sender-rejected',
  HANDOFF_TIMEOUT: 'handoff-timeout',
  SOFTWARE_UNSUPPORTED: 'software-unsupported',
  WITHDRAWN: 'withdrawn',
  CANCELLED: 'cancelled',
  ...TRANSFER_FAILURE,
} as const;
export type HandoffErrorCode = typeof HANDOFF_ERROR[keyof typeof HANDOFF_ERROR];

/** A material lot a machine consumed for a unit. */
export interface TraceMaterial {
  material: string;
  lot: string;
}

/** One unit as a machine finished it, kept on the handoff row so a search by lot finds it. */
export interface TraceEntry {
  unitId: string;
  machineId: string;
  jobId: string | null;
  result: string | null;
  materials: TraceMaterial[];
}

/**
 * Facets a handoff row gains as the sender finishes its units: `trace`, one
 * entry per unit, and `lots`, every lot those units consumed. Both are
 * containment-searchable, e.g. `{ lots: ['LOT-7'] }`.
 */
export const TRACE_FACET = { TRACE: 'trace', LOTS: 'lots' } as const;

/** What resolves a handoff row, from a machine or from a person's form. */
export interface HandoffResolution {
  received: boolean;
  receiver?: string;
  /** Every unit received, on success. */
  units?: string[];
  /** The unit that failed, on an error. */
  unitId?: string;
  /** The machine that reported the error, when it is not the one resolving. */
  reportedBy?: string;
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

/** Units a sender finished as not ok leave the automated line: they finish by hand or as scrap, and never re-enter it. */
const LEAVES_LINE: readonly HandoffErrorCode[] = [HANDOFF_ERROR.SENDER_REJECTED];

/** The decisions an operator may take on a failed handoff; retry only while the units are still on the line. */
export function handoffDecisions(errorCode?: HandoffErrorCode): Decision[] {
  const offLine = !!errorCode && LEAVES_LINE.includes(errorCode);
  return offLine ? [DECISION.MANUAL, DECISION.SCRAP] : [DECISION.RETRY, DECISION.MANUAL, DECISION.SCRAP];
}

export interface OperatorResolution {
  decision: Decision;
  note?: string;
}

/** Signal keys for the unit workflow; every attempt mints a fresh key. */
export const signalKeys = {
  handoff: (jobKey: string, step: number, attempt: number) => `handoff-${jobKey}-s${step}-a${attempt}`,
  handoffError: (jobKey: string, step: number, attempt: number, round = 1) =>
    `handoff-error-${jobKey}-s${step}-a${attempt}${round > 1 ? `-r${round}` : ''}`,
};

/** Metadata on a machine-command row. */
export interface CommandFacets {
  siteId: string;
  lineId: string;
  machineId: string;
  op: string;
  args: Record<string, unknown>;
}

export const COMMAND_STATUS = { ...REPLY_STATUS, NO_REPLY: 'no-reply', UNSUPPORTED: 'unsupported' } as const;
export type CommandStatus = typeof COMMAND_STATUS[keyof typeof COMMAND_STATUS];

/** What resolves a machine-command row: the machine's reply, as data. */
export interface CommandResolution {
  accepted: boolean;
  machineId: string;
  op: string;
  status: CommandStatus;
  reason?: string;
}

export const dispatchCommandId = (escalationId: string) => `${escalationId}:dispatch`;
export const controlCommandId = (escalationId: string) => `${escalationId}:command`;
export const cancelCommandId = (escalationId: string) => `${escalationId}:cancel`;
