/**
 * reconcile() — the pure heart of the digital twin. Given the current mirror and
 * this tick's observation (poll ground truth + the read-back of every open
 * escalation), it returns the next mirror plus the typed actions the batch
 * activity should execute. No I/O, fully deterministic, exhaustively tested.
 *
 * Invariants: poll wins every physical field; the twin never advances past a
 * decision on assumption — it opens an escalation and waits; each escalation
 * kind is created at most once (the open-row ledger); a broker-dispatched job is
 * reported terminal exactly once. See ARCHITECTURE.md and DIGITAL_TWIN_SPEC.md.
 */

import {
  OFFLINE_GIVEUP_S,
  PREPARE_STUCK_S,
  type Mirror,
  type TwinObservation,
  type ReconcileAction,
  type ReconcileResult,
  type EscalationKind,
  type EscalationSpec,
  type TwinCommandKind,
  type BambuGcodeState,
} from './mirror';
import { applySnapshot, confirmPending, enterPhase, secondsInPhase, isOfflineConfirmed } from './mirror-ingest';
import { twinAdvertFacets } from './policy';
import {
  PRINT_ONBOARDER,
  PRINT_SERVICER,
  PRINTER_FLEET,
  TWIN_STATE,
  TWIN_WORKFLOWS,
  type TwinJobPayload,
  type PrintOutcome,
} from './types';

const SERVICER_KINDS: EscalationKind[] = [
  'register', 'filament_change', 'failure_inspect', 'offline_investigate', 'reset_stuck', 'prepare_stuck', 'service',
];

function hasOpenServicer(m: Mirror): boolean {
  return SERVICER_KINDS.some((k) => m.openEscalations[k]);
}

/** The availability advert the broker claims — facets kept identical to the broker's query. */
function advertSpec(m: Mirror): EscalationSpec {
  const reg = m.registration!;
  return {
    role: PRINTER_FLEET,
    subtype: TWIN_STATE.READY,
    description: `Printer ${m.printerId} (${reg.model}) available to print`,
    priority: 2,
    metadata: { ...twinAdvertFacets(m.printerId, reg), state: TWIN_STATE.READY },
  };
}

/**
 * A human escalation spec. The FORM is NOT declared here — it belongs to the
 * target `role` (its versioned form_schema, declared in seed-twin.ts). We carry
 * the machine's current filament in metadata so a servicer reloads the SAME kind
 * (a wrong reload changes the printer's capability and shrinks that pool).
 */
function servicerSpec(
  m: Mirror,
  role: string,
  subtype: string,
  description: string,
  priority: number,
): EscalationSpec {
  return {
    role,
    subtype,
    description,
    priority,
    metadata: { printerId: m.printerId, sn: m.sn, state: subtype, filament: m.filamentLoaded ?? m.registration?.filament ?? '' },
  };
}

export function reconcile(mirror: Mirror, obs: TwinObservation): ReconcileResult {
  const m: Mirror = structuredClone(mirror);
  const actions: ReconcileAction[] = [];
  const now = obs.now;

  // ── inline effects (capture m/actions/now) ────────────────────────────────
  const issue = (command: TwinCommandKind, expect: BambuGcodeState | 'BOUND' | 'UNBOUND', job?: TwinJobPayload) => {
    actions.push({ type: 'issueCommand', command, sn: m.sn, job });
    m.pendingCommand = { opt: command, issuedAt: now, expect, attempts: 1 };
  };
  const ensure = (kind: EscalationKind, spec: EscalationSpec) => {
    if (m.openEscalations[kind]) return; // already open — the ledger's idempotency guard
    actions.push({ type: 'createEscalation', kind, spec });
  };
  const report = (outcome: PrintOutcome) => {
    if (m.activeJob && m.activeJob.reportedOutcome == null) {
      actions.push({ type: 'reportBroker', callbackKey: m.activeJob.callbackKey, outcome, job: m.activeJob });
      m.activeJob.reportedOutcome = outcome;
    }
  };

  // ── 0. consume escalation resolutions/cancellations ───────────────────────
  for (const kind of Object.keys(m.openEscalations) as EscalationKind[]) {
    const id = m.openEscalations[kind];
    const o = id ? obs.escalations[id] : undefined;
    if (!o || o.status === 'pending') continue;
    delete m.openEscalations[kind];
    if (o.status === 'cancelled') {
      if (kind === 'ready') ensure('service', servicerSpec(m, PRINT_SERVICER, 'service', `Printer ${m.printerId} advert cancelled — realign`, 1));
      continue;
    }
    // resolved
    const p = (o.resolverPayload ?? {}) as Record<string, any>;
    if (kind === 'register') {
      m.registration = p as any;
      m.sn = String(p.serialNumber ?? m.sn);
      m.model = String(p.model ?? m.model);
      m.filamentLoaded = String(p.filament ?? m.filamentLoaded ?? '');
      issue('bind', 'BOUND');
    } else if (kind === 'ready') {
      const job = p as TwinJobPayload;
      if (job.powerdown) enterPhase(m, 'retiring', now);
      else if (job.callbackKey) {
        m.activeJob = { jobId: job.jobId, orderId: job.orderId, unitIndex: job.unitIndex, gcodeUrl: job.gcodeUrl, callbackKey: job.callbackKey, reportedOutcome: null, startedAt: now };
        issue('print', 'PREPARE', job);
        enterPhase(m, 'printing', now);
      }
    } else if (kind === 'filament_change') {
      if (p.filamentLoaded) {
        m.filamentLoaded = String(p.filamentLoaded);
        if (m.registration) m.registration = { ...m.registration, filament: String(p.filamentLoaded) };
      }
      m.services += 1;
      issue('resume', 'RUNNING');
    } else if (kind === 'failure_inspect') {
      m.services += 1;
      if (p.action === 'decommission') {
        enterPhase(m, 'retiring', now);
      } else {
        issue('bed_clean', 'IDLE');
        enterPhase(m, 'needs_reset', now);
      }
    } else if (kind === 'service') {
      m.services += 1;
      if (p.filamentLoaded) m.filamentLoaded = String(p.filamentLoaded);
    } else {
      // offline_investigate / prepare_stuck / reset_stuck — a manual clear; poll drives recovery.
      m.services += 1;
    }
  }

  // ── 1. out-of-band retire request ─────────────────────────────────────────
  if (obs.retireRequested && m.phase !== 'retiring' && m.phase !== 'retired') enterPhase(m, 'retiring', now);

  // ── 2. ingest poll (poll wins) ────────────────────────────────────────────
  if (obs.poll) {
    if (obs.poll.ok) {
      m.consecutivePollFailures = 0;
      applySnapshot(m, obs.poll.snapshot, new Date(now).toISOString());
    } else if (obs.poll.error === 'transport') {
      m.consecutivePollFailures += 1; // NOT offline — retain phase + last-good
    } else {
      m.bound = false; // unbound — needs (re)bind
    }
  }
  confirmPending(m);

  // ── 3. phase machine ──────────────────────────────────────────────────────
  const state = m.gcodeState;
  switch (m.phase) {
    case 'onboarding': {
      if (!m.registration) {
        ensure('register', servicerSpec(m, PRINT_ONBOARDER, TWIN_STATE.REGISTERING, `Register printer ${m.printerId}: bind it and record its identity`, 1));
      } else if (m.bound) {
        enterPhase(m, 'ready', now);
      } else if (!m.pendingCommand) {
        issue('bind', 'BOUND'); // retry bind until poll confirms membership
      }
      break;
    }
    case 'ready': {
      if (isOfflineConfirmed(m)) { enterPhase(m, 'offline', now); break; }
      if (state === 'RUNNING' || state === 'PREPARE') {
        // adopted an in-flight job we didn't start — babysit, don't force-stop.
        ensure('service', servicerSpec(m, PRINT_SERVICER, 'service', `Printer ${m.printerId} running an unexpected job`, 3));
        enterPhase(m, 'printing', now);
      } else if (m.bound && m.online && !hasOpenServicer(m)) {
        ensure('ready', advertSpec(m)); // advertise availability; broker resolves with a job
      }
      break;
    }
    case 'printing': {
      if (isOfflineConfirmed(m)) {
        ensure('offline_investigate', servicerSpec(m, PRINT_SERVICER, 'offline_investigate', `Printer ${m.printerId} went offline mid-print`, 1));
        enterPhase(m, 'offline', now); // hold the broker report — the job may survive
        break;
      }
      if (state === 'FINISH') {
        report('success'); m.jobsCompleted += 1; issue('bed_clean', 'IDLE'); enterPhase(m, 'needs_reset', now);
      } else if (state === 'FAILED') {
        if (m.ourStop) { report('cancel'); m.ourStop = false; issue('bed_clean', 'IDLE'); enterPhase(m, 'needs_reset', now); }
        else { report('fail'); ensure('failure_inspect', servicerSpec(m, PRINT_SERVICER, 'failure_inspect', `Print failed on printer ${m.printerId} — inspect`, 1)); enterPhase(m, 'failed_inspect', now); }
      } else if (state === 'PAUSE') {
        if (m.hmsClass === 'filament') { ensure('filament_change', servicerSpec(m, PRINT_SERVICER, 'filament_change', `Printer ${m.printerId} ran out of filament — reload`, 1)); enterPhase(m, 'paused_filament', now); }
        else enterPhase(m, 'paused_operator', now);
      } else if (state === 'PREPARE' && secondsInPhase(m, now) > PREPARE_STUCK_S) {
        ensure('prepare_stuck', servicerSpec(m, PRINT_SERVICER, 'prepare_stuck', `Printer ${m.printerId} stuck preparing`, 2));
      }
      break;
    }
    case 'needs_reset': {
      if (state === 'IDLE') { m.activeJob = null; enterPhase(m, 'ready', now); }
      else if (!m.pendingCommand) issue('bed_clean', 'IDLE'); // re-issue until the reset confirms
      break;
    }
    case 'paused_filament': {
      if (state === 'RUNNING') enterPhase(m, 'printing', now);
      else if (state === 'FINISH' || state === 'FAILED') enterPhase(m, 'printing', now); // fall through next tick
      // else waiting on the filament_change escalation (opened when we entered)
      break;
    }
    case 'paused_operator': {
      if (state === 'RUNNING') enterPhase(m, 'printing', now);
      else if (state === 'FAILED' || state === 'FINISH') enterPhase(m, 'printing', now);
      break;
    }
    case 'failed_inspect': {
      // waiting on the failure_inspect resolution (reset → needs_reset, decommission → retiring)
      break;
    }
    case 'offline': {
      if (m.online) {
        const offId = m.openEscalations.offline_investigate;
        if (offId) {
          actions.push({ type: 'resolveEscalation', kind: 'offline_investigate', id: offId, payload: { action: 'returned-online' } });
          delete m.openEscalations.offline_investigate;
        }
        if (state === 'RUNNING' || state === 'PREPARE') enterPhase(m, 'printing', now);
        else if (state === 'FINISH') { report('success'); m.jobsCompleted += 1; issue('bed_clean', 'IDLE'); enterPhase(m, 'needs_reset', now); }
        else if (state === 'FAILED') { report('fail'); ensure('failure_inspect', servicerSpec(m, PRINT_SERVICER, 'failure_inspect', `Printer ${m.printerId} returned failed — inspect`, 1)); enterPhase(m, 'failed_inspect', now); }
        else if (state === 'PAUSE' && m.hmsClass === 'filament') { ensure('filament_change', servicerSpec(m, PRINT_SERVICER, 'filament_change', `Printer ${m.printerId} paused on filament — reload`, 1)); enterPhase(m, 'paused_filament', now); }
        else { if (m.activeJob) report('cancel'); m.activeJob = null; enterPhase(m, 'ready', now); }
      } else {
        // still dark — free a wedged order once we've waited long enough
        if (m.activeJob && m.activeJob.reportedOutcome == null && secondsInPhase(m, now) > OFFLINE_GIVEUP_S) report('cancel');
      }
      break;
    }
    case 'retiring': {
      if (m.activeJob && m.activeJob.reportedOutcome == null && (state === 'RUNNING' || state === 'PREPARE' || state === 'PAUSE')) {
        if (!m.pendingCommand) { m.ourStop = true; issue('stop', 'FAILED'); }
      } else if (state === 'FINISH' || state === 'FAILED') {
        if (m.activeJob) report('cancel');
        if (!m.pendingCommand) issue('bed_clean', 'IDLE');
      } else if (m.bound && state === 'IDLE') {
        if (!m.pendingCommand) issue('unbind', 'UNBOUND');
      } else if (!m.bound) {
        for (const k of Object.keys(m.openEscalations) as EscalationKind[]) {
          const id = m.openEscalations[k];
          if (id) actions.push({ type: 'resolveEscalation', kind: k, id, payload: { action: 'retired' } });
        }
        m.openEscalations = {};
        enterPhase(m, 'retired', now);
      }
      break;
    }
    case 'retired':
      break;
  }

  return { mirror: m, actions };
}
