/**
 * Machine messages to gateway actions: the escalation verbs a person would
 * perform, performed for the machine. Each unit's arrival and the sender's
 * finished record accumulate on the handoff row, and the last expected item
 * resolves it. A failure on either side resolves it with an error. A job's
 * start, its progress steps, and the alarms that pause it are noted on the row
 * that holds it (lifecycle.ts). Alarms that stop work and machines that go
 * dark or quiet become rows for people. A restarted machine gets back the
 * dispatches it lost. Everything else stays in the stream.
 *
 * A message whose row does not exist yet is nak'd and arrives again; one whose
 * row already closed is acked, so a replay never resolves anything twice.
 */

import { DECISION, HANDOFF_ERROR, LINE_ROLE, ROW_TYPE, itemKeys } from '../contracts';
import { JOB_EVENT, JOB_RESULT, LEVEL, MESSAGE_KIND, OP, STOPPING_LEVELS, type Envelope, type ParsedTopic } from '../../../lib/machines/protocol';
import { DISPOSITION } from '../../../lib/machines/transport';
import { ESCALATION_ENVELOPE_KEYS, type EscalationLookupRef } from '../../../types/escalation';
import { CONTROLLER, type Action, type Plan } from './actions';
import { dispatchAction } from './pacing';
import { failHandoff } from './plan-shared';
import { dispatchJobs, jobOwns } from './jobs';
import { noteJobEvent, notePause, noteResume } from './lifecycle';
import { mergeTrace, traceEntry, traceFacets } from './trace';
import { DISPATCH_STATE, type AlarmTrack, type GatewayState, type HandoffRow } from './state';

const ack = (actions: Action[] = []): Plan => ({ actions, disposition: DISPOSITION.ACK });
const nak: Plan = { actions: [], disposition: DISPOSITION.NAK };

export function planMachineMessage(state: GatewayState, parsed: ParsedTopic, env: Envelope | null, dispatchTtlMs: number): Plan {
  const m = parsed.ident.machineId;
  const b: Record<string, any> = env?.body ?? {};
  const plan = planByKind(state, m, parsed, env, b, dispatchTtlMs);
  return { ...plan, actions: [...heard(state, m), ...plan.actions] };
}

function planByKind(state: GatewayState, m: string, parsed: ParsedTopic, env: Envelope | null, b: Record<string, any>, ttl: number): Plan {
  switch (parsed.kind) {
    case MESSAGE_KIND.REPLY:
      return ack([{ kind: 'settleReply', cmdId: b.cmdId, status: b.status, reason: b.reason }]);
    case MESSAGE_KIND.JOB:
      return planJob(state, m, b, env?.at, ttl);
    case MESSAGE_KIND.ALARM:
      return planAlarm(state, parsed, parsed.key ?? b.alarmId, env);
    case MESSAGE_KIND.PRESENCE:
      return planPresence(state, m, b);
    case MESSAGE_KIND.SNAPSHOT:
      return planSnapshot(state, m, b, ttl);
    default:
      return ack();
  }
}

/** Any message proves a quiet machine is talking again. */
function heard(state: GatewayState, m: string): Action[] {
  const link = state.link(m);
  link.lastSeen = Date.now();
  if (!link.quietRowId) return [];
  const rowId = link.quietRowId;
  link.quietRowId = undefined;
  return [{ kind: 'resolve', as: CONTROLLER, rowId, payload: { decision: DECISION.RESTORED, note: `${m} is talking again` } }];
}

/** Ack when the matching row already closed (a replay or a cancel); otherwise wait for the row. */
function missing(state: GatewayState, unitId: string, pred: (r: HandoffRow) => boolean): Plan {
  return state.closedFor(unitId, pred) ? ack() : nak;
}

/** Whether a machine's job id belongs to `jobId`; a row for some of a job's units still owns it. */
function ownsJob(jobId: string | null, reported: unknown): boolean {
  if (!jobId || typeof reported !== 'string') return true;
  return jobOwns(jobId, reported);
}

/** Keep the receiver's arrival event for the unit, to go out with its dispatch. */
function withArrival(row: HandoffRow, unitId: string, b: Record<string, any>): HandoffRow {
  row.arrivals = { ...row.arrivals, [unitId]: b };
  return row;
}

/** The unit an open handoff into `m` carries on `carrierId`, for a scan that read only the carrier. */
function unitOnCarrier(state: GatewayState, m: string, carrierId: unknown): string | undefined {
  if (typeof carrierId !== 'string') return undefined;
  for (const r of state.open()) {
    if (r.toMachine !== m) continue;
    const unit = r.units.find((u) => u.carrierId === carrierId);
    if (unit) return unit.unitId;
  }
  return undefined;
}

function planJob(state: GatewayState, m: string, b: Record<string, any>, at: string | undefined, ttl: number): Plan {
  const unitId = typeof b.unitId === 'string' ? b.unitId : unitOnCarrier(state, m, b.carrierId);
  // A carrier no open handoff here carries yet: its row may still be on the way.
  if (unitId === undefined) return nak;
  // An event from an earlier attempt's job never touches a later attempt's row.
  const toHere = (r: HandoffRow) => r.toMachine === m && ownsJob(r.jobId, b.jobId);
  const fromHere = (r: HandoffRow) => r.fromMachine === m && ownsJob(r.senderJobId, b.jobId);

  if (b.event === JOB_EVENT.ARRIVED) {
    const row = state.openFor(unitId, toHere);
    if (!row) return missing(state, unitId, toHere);
    const expected = row.units.find((u) => u.unitId === unitId)?.carrierId;
    if (expected && b.carrierId && expected !== b.carrierId) {
      return ack(failHandoff(state, row, m, {
        received: false, unitId, errorCode: HANDOFF_ERROR.CARRIER_MISMATCH, detail: `${m} read carrier ${b.carrierId}, expected ${expected}`,
      }));
    }
    // The unit is at the receiver now, and off the sender.
    const job = dispatchJobs(row.jobId, row.units, state.unitsPerDispatch).find((j) => j.units.some((u) => u.unitId === unitId));
    if (job) state.hold(m, unitId, job.jobId);
    const early = row.fromMachine ? releasedEarly(state, row, unitId) : [];
    if (row.fromMachine) state.letGo(row.fromMachine, unitId);
    const units = row.units.map((u) => u.unitId);
    const complete = row.dispatch === DISPATCH_STATE.ARRIVING
      ? { keys: units.map(itemKeys.arrived), then: [dispatchAction(withArrival(row, unitId, b), m, ttl)] }
      : { keys: units.map(itemKeys.arrived), payload: { received: true, receiver: m, units } };
    return ack([...early, {
      kind: 'accumulate', as: m, rowId: row.id, itemKey: itemKeys.arrived(unitId),
      payload: {
        unitId, carrierId: b.carrierId ?? null, from: b.peer ?? null, at: at ?? new Date().toISOString(),
        ...(row.dispatch === DISPATCH_STATE.ARRIVING ? { arrival: b } : {}),
      },
      complete,
    }]);
  }

  if (b.event === JOB_EVENT.FINISHED) {
    const row = state.openFor(unitId, fromHere);
    if (!row) {
      if (!state.closedFor(unitId, fromHere)) state.rememberFinish(m, unitId, b);
      return missing(state, unitId, fromHere);
    }
    state.takeFinish(m, unitId);
    const released = releasedAction(row, m, b);
    if (b.result === JOB_RESULT.OK) return ack([released]);
    return ack([released, ...failHandoff(state, row, m, {
      received: false, unitId, errorCode: HANDOFF_ERROR.SENDER_REJECTED, reason: b.reason ?? null, detail: `${m} finished ${unitId}: ${b.result}${b.reason ? ` (${b.reason})` : ''}`,
    })]);
  }

  if (b.event === JOB_EVENT.TRANSFER_FAILED) {
    const either = (r: HandoffRow) => toHere(r) || fromHere(r);
    const row = state.openFor(unitId, either);
    if (!row) return missing(state, unitId, either);
    return ack(failHandoff(state, row, m, { received: false, unitId, errorCode: b.failure, detail: `${m} reported ${b.failure}` }));
  }

  if (b.event === JOB_EVENT.RELEASED) {
    state.letGo(m, unitId);
    return ack();
  }

  if (b.event === JOB_EVENT.WITHDRAWN) {
    state.letGo(m, unitId);
    const row = state.openFor(unitId, toHere);
    if (!row) return ack();
    return ack(failHandoff(state, row, m, { received: false, unitId, errorCode: HANDOFF_ERROR.WITHDRAWN, detail: `${m} gave up ${b.jobId}` }));
  }

  if (b.event === JOB_EVENT.STARTED || b.event === JOB_EVENT.PROGRESS) return ack(noteJobEvent(state, m, b, at));

  return ack();
}

function releasedAction(row: HandoffRow, m: string, b: Record<string, any>): Action {
  row.trace = mergeTrace(row.trace, [traceEntry(m, b)]);
  return { kind: 'accumulate', as: m, rowId: row.id, itemKey: itemKeys.released(b.unitId), payload: b, metadata: traceFacets(row.trace) };
}

/** The sender's finished record that came before the row, written ahead of the arrival that may resolve it. */
function releasedEarly(state: GatewayState, row: HandoffRow, unitId: string): Action[] {
  const b = state.takeFinish(row.fromMachine!, unitId);
  if (!b || b.result !== JOB_RESULT.OK || !ownsJob(row.senderJobId, b.jobId)) return [];
  return [releasedAction(row, row.fromMachine!, b)];
}

function planAlarm(state: GatewayState, parsed: ParsedTopic, alarmId: string, env: Envelope | null): Plan {
  const { siteId, lineId, machineId: m } = parsed.ident;
  const key = state.alarmKey(m, alarmId);
  const b: Record<string, any> = env?.body ?? {};
  if (!env || b.active === false) {
    const track = state.alarms.get(key);
    state.alarms.delete(key);
    const resumed = track ? noteResume(state, track, b) : [];
    if (!track?.rowId || !track.open) return ack(resumed);
    return ack([...resumed, {
      kind: 'resolve', as: CONTROLLER, rowId: track.rowId,
      payload: { decision: DECISION.CLEARED, clearedBy: b.clearedBy ?? null, note: `cleared at ${m}${b.clearedBy ? ` by ${b.clearedBy}` : ''}` },
    }]);
  }
  if (!STOPPING_LEVELS.includes(b.level)) return ack();
  const known = state.alarms.get(key);
  if (known && (!known.raisedAt || !b.raisedAt || known.raisedAt === b.raisedAt)) return ack();
  const superseded: Action[] = known?.rowId && known.open
    ? [{ kind: 'resolve', as: CONTROLLER, rowId: known.rowId, payload: { decision: DECISION.CLEARED, note: `${m} raised ${alarmId} again; this one ended` } }]
    : [];
  const track: AlarmTrack = { machineId: m, alarmId, raisedAt: b.raisedAt, open: true };
  state.alarms.set(key, track);
  return ack([...superseded, ...notePause(state, track, b), {
    kind: 'createAlarmRow', machineId: m, alarmId,
    row: {
      type: ROW_TYPE.ALARM, subtype: b.level, role: LINE_ROLE.OPERATOR, priority: b.level === LEVEL.EMERGENCY ? 1 : 2,
      description: `${m}: ${b.text}`,
      metadata: {
        siteId, lineId, machineId: m, alarmId, code: b.code, level: b.level, raisedAt: b.raisedAt,
        zone: b.zone ?? null, autoClears: b.autoClears ?? false, action: b.action ?? null, jobId: b.jobId ?? null,
      },
      ...catalogEnvelope(b.catalog),
    },
  }]);
}

/** An alarm naming the catalog edition its code comes from carries that edition as a lookup, so the row reads its meaning. */
function catalogEnvelope(catalog: unknown): { envelope?: string } {
  const ref = catalog as EscalationLookupRef | undefined;
  if (!ref || typeof ref.domain !== 'string' || typeof ref.key !== 'string') return {};
  return { envelope: JSON.stringify({ [ESCALATION_ENVELOPE_KEYS.LOOKUPS]: [ref] }) };
}

function planPresence(state: GatewayState, m: string, b: Record<string, any>): Plan {
  const link = state.link(m);
  if (b.online !== true) {
    if (link.online) link.since = Date.now();
    link.online = false;
    if (link.rowId || link.watching) return ack();
    link.watching = true;
    return ack([{ kind: 'watchOffline', machineId: m }]);
  }
  if (b.software) link.software = b.software;
  const wasOffline = !link.online;
  link.online = true;
  link.watching = false;
  const actions: Action[] = [];
  // Back from a drop: ask for the full state rather than wait for the next heartbeat.
  if (wasOffline) actions.push({ kind: 'command', machineId: m, op: OP.SNAPSHOT, cmdId: `${m}:resync:${link.since}`, args: {} });
  if (link.rowId) {
    actions.push({ kind: 'resolve', as: CONTROLLER, rowId: link.rowId, payload: { decision: DECISION.RESTORED, note: `${m} back online` } });
    link.rowId = undefined;
  }
  return ack(actions);
}

/** A new boot id means the machine restarted and lost its queue: send its open dispatches again. */
function planSnapshot(state: GatewayState, m: string, b: Record<string, any>, ttl: number): Plan {
  const link = state.link(m);
  if (b.software) link.software = b.software;
  const jobIds: string[] = Array.isArray(b.jobs) ? b.jobs.map((j: any) => j?.jobId).filter((id: unknown) => typeof id === 'string') : [];
  if (Array.isArray(b.jobs)) state.keepHeld(m, new Set(jobIds));
  const fresh = !state.retainedAlarms && !state.readingRetained && Array.isArray(b.alarms);
  const cleared = fresh ? alarmsNoLongerListed(state, m, b.alarms) : [];
  const answer: Action = { kind: 'settleSnapshot', machineId: m, jobIds };
  const previous = link.bootId;
  link.bootId = b.bootId;
  if (!previous || previous === b.bootId) return ack([...cleared, answer]);
  const held = new Set(jobIds);
  const missing = (r: HandoffRow) => dispatchJobs(r.jobId, r.units, state.unitsPerDispatch).some((j) => !held.has(j.jobId));
  const lost = state.open().filter((r) => r.toMachine === m && r.dispatch === DISPATCH_STATE.ACCEPTED && missing(r));
  return ack([...cleared, answer, ...lost.map((r) => dispatchAction(r, m, ttl))]);
}

/** Alarm rows for `m` whose alarm its snapshot no longer lists: they cleared at the machine. */
function alarmsNoLongerListed(state: GatewayState, m: string, listed: unknown[]): Action[] {
  const active = new Set(listed.filter((id): id is string => typeof id === 'string'));
  const actions: Action[] = [];
  for (const [key, track] of [...state.alarms.entries()]) {
    if (track.machineId !== m || active.has(track.alarmId)) continue;
    state.alarms.delete(key);
    actions.push(...noteResume(state, track, {}));
    if (track.open && track.rowId) {
      actions.push({ kind: 'resolve', as: CONTROLLER, rowId: track.rowId, payload: { decision: DECISION.CLEARED, note: `cleared at ${m}; its snapshot no longer lists it` } });
    }
  }
  return actions;
}
