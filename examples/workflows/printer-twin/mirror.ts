/**
 * The digital twin's object structure — the canonical mirror + the reconcile
 * contract. One `Mirror` per physical printer, reconciled from POLL ground truth
 * every tick (poll wins every conflict), so the twin self-heals within one poll
 * interval. `reconcile()` (in reconcile.ts) is a pure function over these types;
 * the batch activity executes the `ReconcileAction[]` it returns.
 *
 * This module is intentionally free of long-tail/HotMesh imports so a dependent
 * project can lift the twin's object model wholesale. No domain- or
 * customer-specific facets belong here — capabilities and filament are opaque
 * strings the marketplace layers own.
 */

import type { TwinRegistration, TwinJobPayload, PrintOutcome } from './types';

// ── Bambu poll shape (the subset of report_status the twin mirrors) ──────────

export type BambuGcodeState = 'IDLE' | 'PREPARE' | 'RUNNING' | 'PAUSE' | 'FINISH' | 'FAILED';

export interface BambuHms {
  attr: number;
  code: number;
  action: number;
  timestamp: number;
}

export interface BambuReportStatus {
  gcode_state: BambuGcodeState;
  mc_percent: number;
  mc_remaining_time: number;
  layer_num: number;
  total_layer_num: number;
  gcode_file: string;
  subtask_name: string;
  task_id: string;
  hms: BambuHms[];
}

/** One device's poll snapshot (normalized from GET /device/{sn} or /devices2). */
export interface BambuDeviceSnapshot {
  sn: string;
  model: string;
  name: string;
  ip: string;
  online: boolean;
  bound: boolean;
  reportStatus: BambuReportStatus;
}

/**
 * The result of a poll attempt. `unbound` = the device isn't in /devices2 yet
 * (needs bind) — NOT an error. `transport` = an HTTP/network failure, which is
 * explicitly NOT "offline" (online is a real field only a successful poll reveals).
 */
export type BambuPollResult =
  | { ok: true; snapshot: BambuDeviceSnapshot }
  | { ok: false; error: 'unbound' | 'transport'; message?: string };

// ── Twin lifecycle ──────────────────────────────────────────────────────────

/**
 * Deterministic print-outcome control for the mock backend — armed per printer
 * (tests) or carried on a job's metadata (the driver) so every reconcile branch
 * is reachable without waiting on RNG. Ignored by the real `http` backend.
 */
export type SimOutcome = 'success' | 'failed' | 'filament_runout';

export type TwinPhase =
  | 'onboarding'
  | 'ready'
  | 'printing'
  | 'needs_reset'
  | 'paused_filament'
  | 'paused_operator'
  | 'failed_inspect'
  | 'offline'
  | 'retiring'
  | 'retired';

/** HMS classification derived from the hms[] signature (poll-only truth). */
export type HmsClass = 'none' | 'filament' | 'fault' | 'other';

/** The escalation kinds the twin raises — its JIT UI at each decision point. */
export type EscalationKind =
  | 'register' // onboarding identity form (print-servicer)
  | 'ready' // availability advert (printer-fleet) — the broker resolves it with a job
  | 'filament_change' // auto-pause on runout (print-servicer)
  | 'failure_inspect' // autonomous FAILED (print-servicer)
  | 'offline_investigate' // offline past threshold (print-servicer)
  | 'reset_stuck' // bed_clean didn't confirm (print-servicer)
  | 'prepare_stuck' // stuck in PREPARE (print-servicer)
  | 'service'; // cancelled-while-idle / generic (print-servicer)

export type TwinCommandKind = 'bind' | 'unbind' | 'print' | 'stop' | 'pause' | 'resume' | 'bed_clean';

/** A command we issued but haven't yet seen confirmed by poll. Drives fast cadence. */
export interface PendingCommand {
  opt: TwinCommandKind;
  issuedAt: number;
  /** The poll-observable state that confirms the command took. */
  expect: BambuGcodeState | 'BOUND' | 'UNBOUND';
  attempts: number;
}

/** The broker-dispatched job in flight — reported terminal exactly once. */
export interface ActiveJob {
  jobId: string;
  orderId: string;
  unitIndex: number;
  gcodeUrl: string;
  /** The broker's dispatched row (signal_key) the twin resolves on terminal. */
  callbackKey: string;
  reportedOutcome: PrintOutcome | null;
  startedAt: number;
}

/**
 * The canonical mirror — persisted in the workflow envelope, carried across
 * batch calls and startChild links. Poll is authoritative for every physical
 * field; the bookkeeping/ledger fields are the twin's alone.
 */
export interface Mirror {
  // Identity
  printerId: string;
  sn: string;
  model: string;
  // Membership / liveness — POLL ONLY (no webhook ever)
  bound: boolean;
  online: boolean;
  // Print state — poll is ground truth
  gcodeState: BambuGcodeState | 'UNKNOWN';
  mcPercent: number;
  mcRemainingTime: number;
  layerNum: number;
  totalLayerNum: number;
  gcodeFile: string;
  subtaskName: string;
  taskId: string;
  hms: BambuHms[];
  hmsClass: HmsClass;
  // Derived
  phase: TwinPhase;
  // Bookkeeping (ours)
  lastSeenAt: string | null;
  consecutiveOfflinePolls: number;
  consecutivePollFailures: number;
  phaseEnteredAt: number;
  pendingCommand: PendingCommand | null;
  /** True while confirming a stop WE issued — so poll(FAILED) routes to reset/cancel, not inspect. */
  ourStop: boolean;
  openEscalations: Partial<Record<EscalationKind, string>>;
  activeJob: ActiveJob | null;
  // Identity/servicing carried facts
  registration?: TwinRegistration;
  filamentLoaded?: string;
  jobsCompleted: number;
  services: number;
  // Continuation
  seq: number;
  link: number;
}

// ── reconcile() I/O contract ─────────────────────────────────────────────────

/** The read-back of one open escalation this tick. */
export interface EscalationObservation {
  status: 'pending' | 'resolved' | 'cancelled';
  resolverPayload?: Record<string, unknown>;
}

/**
 * Everything reconcile() needs that came from I/O this tick. `now` is passed in
 * (never read inside reconcile) so the function stays pure and testable. `poll`
 * is null only before we have a serial to poll (pre-registration).
 */
export interface TwinObservation {
  now: number;
  poll: BambuPollResult | null;
  /** Keyed by escalation id — one entry per id in mirror.openEscalations. */
  escalations: Record<string, EscalationObservation>;
  /** A retire/powerdown request observed out of band (shift teardown, admin). */
  retireRequested?: boolean;
}

/** A new escalation the executor will create. The FORM is not here — it is the
 *  target role's versioned form_schema (declared on the role). */
export interface EscalationSpec {
  role: string;
  subtype: string;
  description: string;
  priority: number;
  metadata: Record<string, unknown>;
}

/** A typed side-effect reconcile() asks the batch executor to perform. */
export type ReconcileAction =
  | { type: 'issueCommand'; command: TwinCommandKind; sn: string; job?: TwinJobPayload }
  | { type: 'createEscalation'; kind: EscalationKind; spec: EscalationSpec }
  | { type: 'resolveEscalation'; kind: EscalationKind; id: string; payload: Record<string, unknown> }
  | { type: 'reportBroker'; callbackKey: string; outcome: PrintOutcome; job: ActiveJob }
  | { type: 'log'; message: string };

export interface ReconcileResult {
  mirror: Mirror;
  actions: ReconcileAction[];
}

// ── Tunables (env-overridable in the batch activity) ─────────────────────────

export const OFFLINE_STRIKES = 2; // successful polls with online=false before crossing to OFFLINE
export const POLL_FAIL_STRIKES = 3; // transport failures before an infra alert (never "offline")
export const PREPARE_STUCK_S = 15; // PREPARE longer than this → prepare_stuck escalation
export const OFFLINE_GIVEUP_S = 600; // in-flight print offline past this → report cancel to broker
export const FILAMENT_HMS = { attr: 50331904, code: 16777222 }; // mock filament-runout signature

/** A fresh mirror for a newly-created twin (pre-onboarding). */
export function freshMirror(printerId: string, now: number, link = 0): Mirror {
  return {
    printerId,
    sn: '',
    model: '',
    bound: false,
    online: false,
    gcodeState: 'UNKNOWN',
    mcPercent: 0,
    mcRemainingTime: 0,
    layerNum: 0,
    totalLayerNum: 0,
    gcodeFile: '',
    subtaskName: '',
    taskId: '',
    hms: [],
    hmsClass: 'none',
    phase: 'onboarding',
    lastSeenAt: null,
    consecutiveOfflinePolls: 0,
    consecutivePollFailures: 0,
    phaseEnteredAt: now,
    pendingCommand: null,
    ourStop: false,
    openEscalations: {},
    activeJob: null,
    jobsCompleted: 0,
    services: 0,
    seq: 0,
    link,
  };
}
