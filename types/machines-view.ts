/**
 * The machine surface as the dashboard sees it: each declared line, the
 * leader's projection of a line, and the wire record of every message a
 * gateway reads or sends. No runtime values; the gateway builds these.
 */

export type MachineAddressing = 'declared' | 'learned';

export interface LineSummaryMachine {
  machineId: string;
  process: string;
  role: string;
  address: string | null;
  addressing: MachineAddressing;
  /** Command ops the line's codec declares beyond the control ops and `snapshot`. */
  rowOps?: readonly string[];
}

export interface LineSummary {
  siteId: string;
  lineId: string;
  machines: LineSummaryMachine[];
}

export interface HeldUnitView {
  unitId: string;
  carrierId: string | null;
  rowId: string;
}

export interface MachineRowsView {
  handoff: number;
  command: number;
  alarm: number;
  offlineRowId: string | null;
  quietRowId: string | null;
}

export interface MachineAlarmView {
  alarmId: string;
  level: string;
  raisedAt: string;
  rowId: string | null;
}

export interface MachineView {
  machineId: string;
  process: string;
  role: string;
  address: string | null;
  /** Null until the machine has been heard. */
  online: boolean | null;
  since: string | null;
  lastSeen: string | null;
  software: string | null;
  bootId: string | null;
  sessionId: string | null;
  heldUnits: HeldUnitView[];
  rows: MachineRowsView;
  alarms: MachineAlarmView[];
  /** The last snapshot's jobs, as the codec reported them. */
  jobs: unknown[];
}

export interface ContestedClaimView {
  address: string;
  station: string;
  rowId: string;
}

export interface LineView {
  siteId: string;
  lineId: string;
  leading: boolean;
  takenAt: string | null;
  machines: MachineView[];
  contested: ContestedClaimView[];
}

export type WireDirection = 'in' | 'out';

export type WireKind = 'presence' | 'snapshot' | 'job' | 'alarm' | 'telemetry' | 'report' | 'cmd' | 'reply' | 'receipt' | 'unknown';

export type WireVerb = 'claim' | 'accumulate' | 'resolve' | 'create-row' | 'refuse' | 'hold' | 'unmatched' | 'unreadable' | 'ack' | 'none';

/** One thing the gateway did, or planned, for a message. */
export interface WireAction {
  verb: WireVerb;
  rowId?: string;
  itemKey?: string;
  detail?: string;
}

export interface WireEvent {
  type: 'machine.wire';
  siteId: string;
  lineId: string;
  machineId: string | null;
  address: string | null;
  direction: WireDirection;
  channel: string;
  topic: string;
  id: string | null;
  at: string;
  retained: boolean;
  kind: WireKind;
  /** Job event name, alarm action, command op, reply status. */
  event: string | null;
  /** One line, built from kind, event and unit or job ids. */
  summary: string;
  violations: string[];
  actions: WireAction[];
  /** The raw wire payload; builders only, stripped for everyone else before it reaches a browser. */
  payload?: unknown;
}

/** A dry run of one message: what the codec read and what the gateway would do. */
export interface InspectResult {
  kind: WireKind | null;
  event: string | null;
  summary: string | null;
  inspections: unknown[];
  violations: string[];
  actions: WireAction[];
}

// The Lines index: every line in the registry with how it is right now.

/** Pending rows on a line, counted by kind, with what they add up to. */
export interface LineHealth {
  /** Declared machines. */
  machines: number;
  offline: number;
  quiet: number;
  alarms: number;
  /** Rows waiting on a person: handoff errors, contract violations and machine registrations. */
  people: number;
  handoff: number;
  command: number;
  /** A machine offline, an active alarm, or a person needed. */
  attention: boolean;
}

/** Who declared the line: `start({ machines })` or the API. */
export type LineSource = 'code' | 'api';

export interface LineIndexRow extends LineSummary {
  source: LineSource;
  version: number;
  enabled: boolean;
  updatedAt: string;
  /** This replica leads the line now. */
  leading: boolean;
  health: LineHealth;
}

export interface SiteSummary {
  siteId: string;
  lines: number;
  /** Lines on the site that need attention. */
  attention: number;
}

export interface LineIndex {
  lines: LineIndexRow[];
  total: number;
  /** Every site in the registry, whatever the page shows. */
  sites: SiteSummary[];
  limit: number;
  offset: number;
}
