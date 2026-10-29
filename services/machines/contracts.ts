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
  /** A message that broke the contract under a strict codec: held for a person, never acted on. */
  CONTRACT_VIOLATION: 'contract-violation',
  /** An address claims a station the line already knows by another address, or the reverse: a person approves or rejects. */
  MACHINE_REGISTRATION: 'machine-registration',
} as const;

export const LINE_ROLE = {
  /** People who clear alarms, bring machines back and decide failed handoffs. */
  OPERATOR: DEFAULT_OPERATOR_ROLE,
  /** People who take finished units off the line: the final handoff. */
  EXIT: DEFAULT_EXIT_ROLE,
  /** The gateway's own identity. */
  CONTROLLER: 'line-controller',
} as const;

/** A file a machine fetches and verifies before it starts, by reference. */
export interface ArtifactRef {
  url: string;
  sha256: string;
}

export interface HandoffUnit {
  unitId: string;
  carrierId: string | null;
  /** This unit's own file, when each unit has one (a per-unit model or toolpath). */
  artifact?: ArtifactRef;
  /** Parameters for this unit alone, sent to the machine as given. */
  parameters?: Record<string, unknown>;
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
  /** Parameters for the job, sent to the machine as given; what they mean is between the host and its codec. */
  parameters?: Record<string, unknown>;
}

const RELEASED_PREFIX = 'released:';
const ARRIVED_PREFIX = 'arrived:';

/**
 * Items a handoff row accumulates, one per unit: the sender's finished-job
 * record, and the receiver's arrival. When every unit's arrival is held, the
 * receiver resolves the row.
 */
export const itemKeys = {
  released: (unitId: string) => `${RELEASED_PREFIX}${unitId}`,
  arrived: (unitId: string) => `${ARRIVED_PREFIX}${unitId}`,
  started: (unitId: string) => `started:${unitId}`,
  progress: (unitId: string, step: number) => `progress:${unitId}:${step}`,
  paused: (alarmId: string, raisedAt: string) => `paused:${alarmId}:${raisedAt}`,
  resumed: (alarmId: string, raisedAt: string) => `resumed:${alarmId}:${raisedAt}`,
};

/** The unit an arrival item names; null for any other item. */
export function arrivedUnit(itemKey: string): string | null {
  return itemKey.startsWith(ARRIVED_PREFIX) ? itemKey.slice(ARRIVED_PREFIX.length) : null;
}

/** Where a handoff's units stand, read from its items. */
export interface HandoffProgress {
  /** Units the sender reported finished and released. */
  released: string[];
  /** Units the receiver reported arrived. */
  arrived: string[];
  /** Units with no arrival, in the handoff's order. */
  missing: string[];
}

/** A handoff's progress from its items (a row's items, or `$accumulated` on a finished wait), for the units it carries. */
export function handoffProgress(units: readonly string[], items: readonly { itemKey: string }[]): HandoffProgress {
  const keys = new Set(items.map((i) => i.itemKey));
  const arrived = units.filter((u) => keys.has(itemKeys.arrived(u)));
  return {
    released: units.filter((u) => keys.has(itemKeys.released(u))),
    arrived,
    missing: units.filter((u) => !arrived.includes(u)),
  };
}

export const HANDOFF_ERROR = {
  DISPATCH_REFUSED: 'dispatch-refused',
  /** Accepted, then the machine could not prepare the job (artifact, recipe). */
  DISPATCH_FAILED: 'dispatch-failed',
  NO_REPLY: 'no-reply',
  SENDER_REJECTED: 'sender-rejected',
  HANDOFF_TIMEOUT: 'handoff-timeout',
  /** The handoff timed out after some of its units arrived; the units are split between two stations. */
  PARTIAL_ARRIVAL: 'partial-arrival',
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

/** The facet a row holding a job carries while it runs: its latest noted progress. */
export const LIFECYCLE_FACET = { PROGRESS: 'progress' } as const;

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

/** Decisions on line-operator rows: failed handoffs, alarms, dark machines, contested registrations. */
export const DECISION = {
  RETRY: 'retry',
  MANUAL: 'manual',
  SCRAP: 'scrap',
  ACKNOWLEDGE: 'acknowledge',
  CLEARED: 'cleared',
  RESTORED: 'restored',
  APPROVE: 'approve',
  REJECT: 'reject',
} as const;
export type Decision = typeof DECISION[keyof typeof DECISION];

/**
 * Failures a retry cannot repair. Units a sender finished as not ok leave the
 * automated line and never re-enter it; units split by a partial arrival are
 * no longer all at the sender, so the same hop cannot move them again.
 */
const NO_RETRY: readonly HandoffErrorCode[] = [HANDOFF_ERROR.SENDER_REJECTED, HANDOFF_ERROR.PARTIAL_ARRIVAL];

/** The decisions an operator may take on a failed handoff; retry only while every unit is still at the sender. */
export function handoffDecisions(errorCode?: HandoffErrorCode): Decision[] {
  const noRetry = !!errorCode && NO_RETRY.includes(errorCode);
  return noRetry ? [DECISION.MANUAL, DECISION.SCRAP] : [DECISION.RETRY, DECISION.MANUAL, DECISION.SCRAP];
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
  jobStop: (jobKey: string, step: number, attempt: number) => `job-stop-${jobKey}-s${step}-a${attempt}`,
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

/** A row's dispatch command in its validity round; a later round is a new command (gateway/pacing.ts dispatchWindow). */
export const dispatchCommandId = (escalationId: string, round = 1) => (round > 1 ? `${escalationId}:dispatch:r${round}` : `${escalationId}:dispatch`);
/** A command row's command in its validity round; a later round is a new command (gateway/pacing.ts dispatchWindow). */
export const controlCommandId = (escalationId: string, round = 1) => (round > 1 ? `${escalationId}:command:r${round}` : `${escalationId}:command`);
export const cancelCommandId = (escalationId: string) => `${escalationId}:cancel`;
