/**
 * Machine messages to gateway actions: the escalation verbs a person would
 * perform, performed for the machine. A receiver's ARRIVED resolves its
 * handoff; the sender's FINISHED record accumulates on it; a failure on
 * either side resolves it with an error. Alarms that stop work and machines
 * that stay dark become rows for people. Everything else stays in the stream.
 *
 * A message whose row does not exist yet is nak'd and arrives again; one whose
 * row already closed is acked, so a replay never resolves anything twice.
 */

import { DECISION, HANDOFF_ERROR, LINE_ROLE, RELEASED_ITEM, ROW_TYPE } from '../contracts';
import { JOB_EVENT, JOB_RESULT, LEVEL, MESSAGE_KIND, OP, STOPPING_LEVELS, type Envelope, type ParsedTopic } from '../protocol';
import { DISPOSITION } from '../transport';
import { CONTROLLER, type Plan } from './actions';
import { failHandoff } from './plan-shared';
import type { GatewayState, HandoffRow } from './state';

const ack = (actions: Plan['actions'] = []): Plan => ({ actions, disposition: DISPOSITION.ACK });
const nak: Plan = { actions: [], disposition: DISPOSITION.NAK };

export function planMachineMessage(state: GatewayState, parsed: ParsedTopic, env: Envelope | null): Plan {
  const machineId = parsed.ident.machineId;
  const b: Record<string, any> = env?.body ?? {};
  switch (parsed.kind) {
    case MESSAGE_KIND.REPLY:
      return ack([{ kind: 'settleReply', cmdId: b.cmdId, status: b.status, reason: b.reason }]);
    case MESSAGE_KIND.JOB:
      return planJob(state, machineId, b, env?.at);
    case MESSAGE_KIND.ALARM:
      return planAlarm(state, machineId, parsed.key ?? b.alarmId, env);
    case MESSAGE_KIND.PRESENCE:
      return planPresence(state, machineId, b.online === true);
    default:
      return ack();
  }
}

/** Ack when the matching row already closed (a replay); otherwise wait for the row. */
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
    if (row.carrierId && b.carrierId && row.carrierId !== b.carrierId) {
      return ack(failHandoff(row, m, {
        received: false, errorCode: HANDOFF_ERROR.CARRIER_MISMATCH, detail: `${m} read carrier ${b.carrierId}, expected ${row.carrierId}`,
      }));
    }
    return ack([{
      kind: 'resolve', as: m, rowId: row.id,
      payload: { received: true, receiver: m, carrierId: b.carrierId ?? null, receivedAt: at ?? new Date().toISOString() },
    }]);
  }

  if (b.event === JOB_EVENT.FINISHED) {
    const row = state.openFor(unitId, fromHere);
    if (!row) return missing(state, unitId, fromHere);
    const released = { kind: 'accumulate' as const, as: m, rowId: row.id, itemKey: RELEASED_ITEM, payload: b };
    if (b.result === JOB_RESULT.OK) return ack([released]);
    return ack([released, ...failHandoff(row, m, {
      received: false, errorCode: HANDOFF_ERROR.SENDER_REJECTED, reason: b.reason ?? null, detail: `${m} finished ${unitId}: ${b.result}`,
    })]);
  }

  if (b.event === JOB_EVENT.TRANSFER_FAILED) {
    const either = (r: HandoffRow) => toHere(r) || fromHere(r);
    const row = state.openFor(unitId, either);
    if (!row) return missing(state, unitId, either);
    return ack(failHandoff(row, m, { received: false, errorCode: b.failure, detail: `${m} reported ${b.failure}` }));
  }

  return ack();
}

function planAlarm(state: GatewayState, m: string, alarmId: string, env: Envelope | null): Plan {
  const key = state.alarmKey(m, alarmId);
  const b: Record<string, any> = env?.body ?? {};
  if (!env || b.active === false) {
    const track = state.alarms.get(key);
    state.alarms.delete(key);
    if (!track?.rowId || !track.open) return ack();
    return ack([{ kind: 'resolve', as: CONTROLLER, rowId: track.rowId, payload: { decision: DECISION.CLEARED, note: `cleared at ${m}` } }]);
  }
  if (!STOPPING_LEVELS.includes(b.level) || state.alarms.has(key)) return ack();
  state.alarms.set(key, { machineId: m, alarmId, open: true });
  return ack([{
    kind: 'createAlarmRow', machineId: m, alarmId,
    row: {
      type: ROW_TYPE.ALARM, subtype: b.level, role: LINE_ROLE.OPERATOR, priority: b.level === LEVEL.EMERGENCY ? 1 : 2,
      description: `${m}: ${b.text}`,
      metadata: {
        machineId: m, alarmId, code: b.code, level: b.level, raisedAt: b.raisedAt,
        zone: b.zone ?? null, autoClears: b.autoClears ?? false, action: b.action ?? null, jobId: b.jobId ?? null,
      },
    },
  }]);
}

function planPresence(state: GatewayState, m: string, online: boolean): Plan {
  const link = state.links.get(m) ?? { online: true, since: Date.now() };
  state.links.set(m, link);
  if (!online) {
    if (link.online) link.since = Date.now();
    link.online = false;
    if (link.rowId || link.watching) return ack();
    link.watching = true;
    return ack([{ kind: 'watchOffline', machineId: m }]);
  }
  const wasOffline = !link.online;
  link.online = true;
  link.watching = false;
  const actions: Plan['actions'] = [];
  // Back from a drop: ask for the full state rather than wait for the next heartbeat.
  if (wasOffline) actions.push({ kind: 'command', machineId: m, op: OP.SNAPSHOT, cmdId: `${m}:resync:${link.since}`, args: {} });
  if (link.rowId) {
    actions.push({ kind: 'resolve', as: CONTROLLER, rowId: link.rowId, payload: { decision: DECISION.RESTORED, note: `${m} back online` } });
    link.rowId = undefined;
  }
  return ack(actions);
}
