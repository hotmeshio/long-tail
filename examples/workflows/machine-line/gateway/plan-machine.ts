/**
 * Machine messages to gateway actions: the escalation verbs a person would
 * perform, performed for the machine. Each unit's arrival and the sender's
 * finished record accumulate on the handoff row, and the last expected item
 * resolves it. A failure on either side resolves it with an error. Alarms that
 * stop work and machines that go dark or quiet become rows for people. A
 * restarted machine gets back the dispatches it lost. Everything else stays
 * in the stream.
 *
 * A message whose row does not exist yet is nak'd and arrives again; one whose
 * row already closed is acked, so a replay never resolves anything twice.
 */

import { DECISION, HANDOFF_ERROR, LINE_ROLE, ROW_TYPE, itemKeys } from '../contracts';
import { JOB_EVENT, JOB_RESULT, LEVEL, MESSAGE_KIND, OP, STOPPING_LEVELS, type Envelope, type ParsedTopic } from '../protocol';
import { DISPOSITION } from '../transport';
import { CONTROLLER, type Action, type Plan } from './actions';
import { dispatchAction } from './plan-escalation';
import { failHandoff } from './plan-shared';
import { DISPATCH_STATE, type GatewayState, type HandoffRow } from './state';

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
      return planJob(state, m, b, env?.at);
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

function planJob(state: GatewayState, m: string, b: Record<string, any>, at?: string): Plan {
  const unitId = b.unitId;
  const toHere = (r: HandoffRow) => r.toMachine === m;
  const fromHere = (r: HandoffRow) => r.fromMachine === m;

  if (b.event === JOB_EVENT.ARRIVED) {
    const row = state.openFor(unitId, toHere);
    if (!row) return missing(state, unitId, toHere);
    const expected = row.units.find((u) => u.unitId === unitId)?.carrierId;
    if (expected && b.carrierId && expected !== b.carrierId) {
      return ack(failHandoff(row, m, {
        received: false, unitId, errorCode: HANDOFF_ERROR.CARRIER_MISMATCH, detail: `${m} read carrier ${b.carrierId}, expected ${expected}`,
      }));
    }
    const units = row.units.map((u) => u.unitId);
    return ack([{
      kind: 'accumulate', as: m, rowId: row.id, itemKey: itemKeys.arrived(unitId),
      payload: { unitId, carrierId: b.carrierId ?? null, from: b.peer ?? null, at: at ?? new Date().toISOString() },
      complete: { keys: units.map(itemKeys.arrived), payload: { received: true, receiver: m, units } },
    }]);
  }

  if (b.event === JOB_EVENT.FINISHED) {
    const row = state.openFor(unitId, fromHere);
    if (!row) return missing(state, unitId, fromHere);
    const released: Action = { kind: 'accumulate', as: m, rowId: row.id, itemKey: itemKeys.released(unitId), payload: b };
    if (b.result === JOB_RESULT.OK) return ack([released]);
    return ack([released, ...failHandoff(row, m, {
      received: false, unitId, errorCode: HANDOFF_ERROR.SENDER_REJECTED, reason: b.reason ?? null, detail: `${m} finished ${unitId}: ${b.result}`,
    })]);
  }

  if (b.event === JOB_EVENT.TRANSFER_FAILED) {
    const either = (r: HandoffRow) => toHere(r) || fromHere(r);
    const row = state.openFor(unitId, either);
    if (!row) return missing(state, unitId, either);
    return ack(failHandoff(row, m, { received: false, unitId, errorCode: b.failure, detail: `${m} reported ${b.failure}` }));
  }

  if (b.event === JOB_EVENT.WITHDRAWN) {
    const row = state.openFor(unitId, toHere);
    if (!row) return ack();
    return ack(failHandoff(row, m, { received: false, unitId, errorCode: HANDOFF_ERROR.WITHDRAWN, detail: `${m} gave up ${b.jobId}` }));
  }

  return ack();
}

function planAlarm(state: GatewayState, parsed: ParsedTopic, alarmId: string, env: Envelope | null): Plan {
  const { siteId, lineId, machineId: m } = parsed.ident;
  const key = state.alarmKey(m, alarmId);
  const b: Record<string, any> = env?.body ?? {};
  if (!env || b.active === false) {
    const track = state.alarms.get(key);
    state.alarms.delete(key);
    if (!track?.rowId || !track.open) return ack();
    return ack([{
      kind: 'resolve', as: CONTROLLER, rowId: track.rowId,
      payload: { decision: DECISION.CLEARED, clearedBy: b.clearedBy ?? null, note: `cleared at ${m}${b.clearedBy ? ` by ${b.clearedBy}` : ''}` },
    }]);
  }
  if (!STOPPING_LEVELS.includes(b.level) || state.alarms.has(key)) return ack();
  state.alarms.set(key, { machineId: m, alarmId, open: true });
  return ack([{
    kind: 'createAlarmRow', machineId: m, alarmId,
    row: {
      type: ROW_TYPE.ALARM, subtype: b.level, role: LINE_ROLE.OPERATOR, priority: b.level === LEVEL.EMERGENCY ? 1 : 2,
      description: `${m}: ${b.text}`,
      metadata: {
        siteId, lineId, machineId: m, alarmId, code: b.code, level: b.level, raisedAt: b.raisedAt,
        zone: b.zone ?? null, autoClears: b.autoClears ?? false, action: b.action ?? null, jobId: b.jobId ?? null,
      },
    },
  }]);
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
  const previous = link.bootId;
  link.bootId = b.bootId;
  if (!previous || previous === b.bootId) return ack();
  const held = new Set((b.jobs ?? []).map((j: any) => j.jobId));
  const lost = state.open().filter((r) => r.toMachine === m && r.dispatch === DISPATCH_STATE.ACCEPTED && !held.has(r.jobId));
  return ack(lost.map((r) => dispatchAction(r, m, ttl)));
}
