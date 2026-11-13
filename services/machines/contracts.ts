/**
 * What the unit workflow and the machine gateway agree on: row types, roles,
 * the metadata a handoff row carries, error codes and resolution shapes. A
 * handoff row is the same for a machine resolver and a person; only the
 * protocol that resolves it differs.
 */

import { DEFAULT_EXIT_ROLE, DEFAULT_OPERATOR_ROLE, DEFAULT_QUALITY_ROLE } from '../../lib/machines/line-roles';
import { REPLY_STATUS, TRANSFER_FAILURE } from '../../lib/machines/protocol/constants';

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
  /** Units a machine finished on hold wait for a quality decision: release, rework or scrap. */
  QUALITY_HOLD: 'quality-hold',
  /** A machine asks the host something: the host answers, and the gateway sends the answer to the machine. */
  MACHINE_REQUEST: 'machine-request',
  /** A machine reports something the host must record, with nothing sent back: whoever records it resolves the row. */
  MACHINE_NOTICE: 'machine-notice',
  /** A machine request or notice still open past its window, shown to the line's operators. */
  REQUEST_OVERDUE: 'machine-request-overdue',
} as const;

export const LINE_ROLE = {
  /** People who clear alarms, bring machines back and decide failed handoffs. */
  OPERATOR: DEFAULT_OPERATOR_ROLE,
  /** People who take finished units off the line: the final handoff. */
  EXIT: DEFAULT_EXIT_ROLE,
  /** People who decide units a machine finished on hold. */
  QUALITY: DEFAULT_QUALITY_ROLE,
  /** The gateway's own identity. */
  CONTROLLER: 'line-controller',
} as const;

/** A file a machine fetches and verifies before it starts, by reference. */
export interface ArtifactRef {
  url: string;
  sha256: string;
  /** The host's id for the file. */
  id?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface HandoffUnit {
  unitId: string;
  carrierId: string | null;
  /** This unit's own file, when each unit has one (a per-unit model or toolpath). */
  artifact?: ArtifactRef;
  /** This unit's files, when it has several. */
  artifacts?: ArtifactRef[];
  /** Parameters for this unit alone, sent to the machine as given. */
  parameters?: Record<string, unknown>;
  /** The host's references for this unit, by name; sent to the machine as given and searchable on the row. */
  refs?: Record<string, string>;
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
  /** The host's references for the job, by name (an order, a batch, a ticket); sent to the machine as given and searchable on the row. */
  refs?: Record<string, string>;
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
  stage: (unitId: string, stage: string) => `stage:${unitId}:${stage}`,
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
  /** An arrival no open handoff into the machine expects, shown to the operator role once per machine and carrier. */
  UNMATCHED_ARRIVAL: 'unmatched-arrival',
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
  /** On `sender-rejected`, how the sender finished the unit: reject, hold, scrap or rework. */
  result?: string;
  reason?: string | null;
  detail?: string;
  /** The machine's structured code for a refusal or failure, when its reply carried one. */
  code?: string;
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
  /** A quality decision on held units: they continue from where they are. */
  RELEASE: 'release',
  /** A quality decision on held units: they run again from a station on the route. */
  REWORK: 'rework',
  /** The machine request an overdue row named has ended. */
  ANSWERED: 'answered',
  /** The machine notice an overdue row named has ended. */
  RECORDED: 'recorded',
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

/** The decisions a quality role may take on units a machine finished on hold. */
export const HOLD_DECISIONS: readonly Decision[] = [DECISION.RELEASE, DECISION.REWORK, DECISION.SCRAP];

export interface QualityResolution extends OperatorResolution {
  /** For `rework`: the station the units run again from; the holding station when absent. */
  station?: string;
}

/** Signal keys for the unit workflow; every attempt mints a fresh key. */
export const signalKeys = {
  handoff: (jobKey: string, step: number, attempt: number) => `handoff-${jobKey}-s${step}-a${attempt}`,
  handoffError: (jobKey: string, step: number, attempt: number, round = 1) =>
    `handoff-error-${jobKey}-s${step}-a${attempt}${round > 1 ? `-r${round}` : ''}`,
  jobStop: (jobKey: string, step: number, attempt: number) => `job-stop-${jobKey}-s${step}-a${attempt}`,
  hold: (jobKey: string, step: number, attempt: number, round = 1) => `hold-${jobKey}-s${step}-a${attempt}${round > 1 ? `-r${round}` : ''}`,
  disposition: (jobKey: string, step: number, attempt: number) => `disposition-${jobKey}-s${step}-a${attempt}`,
};

/** Metadata on a machine-command row. */
export interface CommandFacets {
  siteId: string;
  lineId: string;
  machineId: string;
  op: string;
  args: Record<string, unknown>;
}

/** `sent`: a one-way command published, with no reply to wait for. */
export const COMMAND_STATUS = { ...REPLY_STATUS, NO_REPLY: 'no-reply', UNSUPPORTED: 'unsupported', SENT: 'sent' } as const;
export type CommandStatus = typeof COMMAND_STATUS[keyof typeof COMMAND_STATUS];

/** What resolves a machine-command row: the machine's reply, as data. */
export interface CommandResolution {
  accepted: boolean;
  machineId: string;
  op: string;
  status: CommandStatus;
  reason?: string;
  /** The machine's structured code for the outcome, when its reply carried one. */
  code?: string;
}

/** A row's dispatch command in its validity round; a later round is a new command (gateway/pacing.ts dispatchWindow). */
export const dispatchCommandId = (escalationId: string, round = 1) => (round > 1 ? `${escalationId}:dispatch:r${round}` : `${escalationId}:dispatch`);
/** A command row's command in its validity round; a later round is a new command (gateway/pacing.ts dispatchWindow). */
export const controlCommandId = (escalationId: string, round = 1) => (round > 1 ? `${escalationId}:command:r${round}` : `${escalationId}:command`);
export const cancelCommandId = (escalationId: string) => `${escalationId}:cancel`;

/** Metadata on a machine-request row. `ref` is the id of the machine message the answer names. */
export interface RequestFacets {
  siteId: string;
  lineId: string;
  machineId: string;
  /** The command the answer is sent as, unless the answer names another. */
  op: string;
  ref: string;
  /** How long the request may wait for an answer before the line's operators are shown it. */
  withinMs?: number;
  /** The machine's message as the codec decoded it. */
  event: Record<string, unknown>;
}

/** Metadata on a machine-notice row: a request's, with what it reports in place of an op. */
export interface NoticeFacets {
  siteId: string;
  lineId: string;
  machineId: string;
  /** The id of the machine message the notice records. */
  ref: string;
  kind?: string;
  /** How long the notice may stay unrecorded before the line's operators are shown it. */
  withinMs?: number;
  event: Record<string, unknown>;
}

/** What a workflow started for a parked request or notice row receives as its data. */
export interface RowWorkflowInput {
  rowId: string;
  type: string;
  siteId: string;
  lineId: string;
  machineId: string;
  op?: string;
  ref: string;
  event: Record<string, unknown>;
}

/** The item an answerer adds to a machine-request row; the gateway sends it and resolves the row. */
export const REQUEST_ITEM = { ANSWER: 'answer' } as const;

/** What an answer item holds: the command's arguments, and the op when it is not the request's. */
export interface RequestAnswer {
  args: Record<string, unknown>;
  op?: string;
}

/** What resolves a machine-request row, from the gateway. */
export interface RequestResolution {
  answered: boolean;
  machineId: string;
  op: string;
  ref: string;
  status: typeof COMMAND_STATUS.SENT | typeof COMMAND_STATUS.UNSUPPORTED;
  reason?: string;
  /** Who added the answer. */
  answeredBy?: string;
}

/** The key a machine request is created under, once per machine message. */
export const requestSignalKey = (siteId: string, lineId: string, machineId: string, ref: string) =>
  `machine-request:${siteId}:${lineId}:${machineId}:${ref}`;
/** The key a machine notice is created under, once per machine message. */
export const noticeSignalKey = (siteId: string, lineId: string, machineId: string, ref: string) =>
  `machine-notice:${siteId}:${lineId}:${machineId}:${ref}`;
/** The id of the workflow started for a parked row, once per row. */
export const rowWorkflowId = (rowType: string, rowId: string) => `${rowType}-${rowId}`;
/** The key a request's overdue row is created under, once per request. */
export const overdueSignalKey = (requestId: string) => `machine-request-overdue:${requestId}`;
/** The command that carries a request's answer. */
export const answerCommandId = (escalationId: string) => `${escalationId}:answer`;
