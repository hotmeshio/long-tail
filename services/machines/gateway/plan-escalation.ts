/**
 * Escalation events to gateway actions. A new handoff row for a machine is the
 * cue to dispatch, exactly as a new row is the cue for a person to look at the
 * dashboard. A cancelled row stops both sides; an expired one withdraws its
 * dispatch; an alarm row a person resolves acknowledges the alarm at the machine.
 * A machine-command row is sent to its machine as the command it names.
 */

import { COMMAND_STATUS, ROW_TYPE, controlCommandId, type CommandFacets, type HandoffFacets } from '../contracts';
import { readCommandFacets } from '../commands';
import { CONTROL_OPS, OP, type Op } from '../../../lib/machines/protocol';
import type { LineDef } from '../../../lib/machines/line';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import { cancelDispatch, cancelSender } from './plan-shared';
import { admit, hasRoom, softwareRefusal } from './pacing';
import { readTrace } from './trace';
import { DISPATCH_STATE, ROW_END, type GatewayState, type HandoffRow } from './state';
import { standardRows, type HandoffRowAdapter } from '../rows';

const VERB = { CREATED: 'created', CLAIMED: 'claimed', RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;

function handoffRow(id: string, role: string, facets: HandoffFacets, metadata?: Record<string, any>): HandoffRow {
  return { ...facets, id, role, dispatch: DISPATCH_STATE.NONE, trace: readTrace(metadata) };
}

/** Rows for another line belong to that line's gateway. */
function onThisLine(line: LineDef, at: { siteId?: unknown; lineId?: unknown }): boolean {
  return at.siteId === line.siteId && at.lineId === line.lineId;
}

export function planEscalationEvent(
  state: GatewayState, line: LineDef, event: EscalationEvent, dispatchTtlMs: number, rows: HandoffRowAdapter = standardRows,
): Action[] {
  const view = { ...event.data, id: event.escalationId, role: event.role };
  const facets = rows.toHandoff(view);
  if (facets) return onThisLine(line, facets) ? planHandoff(state, line, event, facets, dispatchTtlMs) : [];
  if (state.get(event.escalationId)) return planHandoff(state, line, event, null, dispatchTtlMs);
  const type = event.data?.type;
  if (!onThisLine(line, event.data?.metadata ?? {})) return [];
  if (type === ROW_TYPE.ALARM) return planAlarmRow(state, event);
  if (type === ROW_TYPE.MACHINE_OFFLINE || type === ROW_TYPE.MACHINE_QUIET) return planLinkRow(state, event);
  if (type === ROW_TYPE.MACHINE_COMMAND) return planCommandRow(state, line, event);
  return [];
}

/** Why the gateway will not send a command row's command; null when it will. */
function commandRefusal(line: LineDef, c: CommandFacets): string | null {
  if (!onLine(line, c.machineId)) return `${c.machineId} is not on ${line.siteId}/${line.lineId}`;
  if (!CONTROL_OPS.includes(c.op as Op)) return `${c.op} is not a command a row may ask for; one of ${CONTROL_OPS.join(', ')}`;
  return null;
}

function planCommandRow(state: GatewayState, line: LineDef, event: EscalationEvent): Action[] {
  const id = event.escalationId;
  if (event.verb === VERB.RESOLVED || event.verb === VERB.CANCELLED || event.verb === VERB.EXPIRED) {
    state.endCommand(id);
    return [];
  }
  if (event.verb !== VERB.CREATED && event.verb !== VERB.CLAIMED) return [];
  const c = readCommandFacets(event.data?.metadata);
  if (!c || !state.trackCommand(id)) return [];
  const refusal = commandRefusal(line, c);
  if (refusal) {
    return [{ kind: 'resolve', as: CONTROLLER, rowId: id, payload: { accepted: false, machineId: c.machineId, op: c.op, status: COMMAND_STATUS.UNSUPPORTED, reason: refusal } }];
  }
  return [{ kind: 'control', rowId: id, machineId: c.machineId, op: c.op, cmdId: controlCommandId(id), args: c.args }];
}

function onLine(line: LineDef, machineId: string | null): machineId is string {
  return !!machineId && line.machines.some((m) => m.machineId === machineId);
}

function planHandoff(state: GatewayState, line: LineDef, event: EscalationEvent, facets: HandoffFacets | null, dispatchTtlMs: number): Action[] {
  const id = event.escalationId;
  if (event.verb === VERB.CREATED || event.verb === VERB.CLAIMED) {
    if (state.isClosed(id) || !facets) return [];
    state.index(handoffRow(id, event.role, facets, event.data?.metadata));
    const row = state.get(id)!;
    // The units now wait on the sender as this row's sender job.
    if (row.fromMachine) for (const u of row.units) state.letGo(row.fromMachine, u.unitId);
    if (!onLine(line, row.toMachine) || row.dispatch !== DISPATCH_STATE.NONE) return [];
    // Read back already claimed: the machine accepted it before this gateway started.
    if (event.data?.assigned_to) {
      row.dispatch = DISPATCH_STATE.ACCEPTED;
      return [];
    }
    const refused = !!softwareRefusal(state, line, row.toMachine);
    if (state.holdDispatch || (!refused && !hasRoom(state, line, row))) {
      row.dispatch = DISPATCH_STATE.WAITING;
      return [];
    }
    return admit(state, line, row, dispatchTtlMs);
  }
  if (event.verb === VERB.CANCELLED) {
    const row = state.close(id, ROW_END.CANCELLED);
    return row ? [...cancelDispatch(state, row), ...cancelSender(state, row)] : [];
  }
  if (event.verb === VERB.EXPIRED) {
    const row = state.close(id, ROW_END.EXPIRED);
    return row ? cancelDispatch(state, row) : [];
  }
  if (event.verb === VERB.RESOLVED) state.close(id);
  return [];
}

function planAlarmRow(state: GatewayState, event: EscalationEvent): Action[] {
  const md = event.data.metadata ?? {};
  const track = state.alarms.get(state.alarmKey(md.machineId, md.alarmId));
  if (event.verb === VERB.CREATED) {
    if (track) track.rowId = event.escalationId;
    return [];
  }
  if (!track || (event.verb !== VERB.RESOLVED && event.verb !== VERB.CANCELLED)) return [];
  track.open = false;
  if (event.verb !== VERB.RESOLVED) return [];
  // Still tracked means the machine has not cleared it: a person acknowledged it.
  return [{
    kind: 'command', machineId: track.machineId, op: OP.ACKNOWLEDGE_ALARM, cmdId: `${event.escalationId}:ack`,
    args: { alarmId: track.alarmId, by: event.data.resolved_by ?? 'line-operator' },
  }];
}

function planLinkRow(state: GatewayState, event: EscalationEvent): Action[] {
  const machineId = event.data.metadata?.machineId;
  const link = machineId ? state.links.get(machineId) : undefined;
  if (!link) return [];
  const quiet = event.data.type === ROW_TYPE.MACHINE_QUIET;
  const ended = event.verb === VERB.RESOLVED || event.verb === VERB.CANCELLED;
  if (quiet) {
    if (event.verb === VERB.CREATED) link.quietRowId = event.escalationId;
    if (ended && link.quietRowId === event.escalationId) link.quietRowId = undefined;
  } else {
    if (event.verb === VERB.CREATED) link.rowId = event.escalationId;
    if (ended && link.rowId === event.escalationId) link.rowId = undefined;
  }
  return [];
}
