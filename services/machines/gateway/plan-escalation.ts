/**
 * Escalation events to gateway actions. A new handoff row for a machine is the
 * cue to dispatch, exactly as a new row is the cue for a person to look at the
 * dashboard. A cancelled or expired row withdraws its dispatch; a row commands
 * only the machine whose role it is parked on, so the sender's job is the
 * workflow's to stop (a machine-command row on the sender's role). An alarm
 * row a person resolves acknowledges the alarm at the machine.
 * A machine-command row is sent to its machine as the command it names.
 */

import { COMMAND_STATUS, ROW_TYPE, type CommandFacets, type HandoffFacets } from '../contracts';
import { readCommandFacets } from '../commands';
import { CONTROL_OPS, OP, type Op } from '../../../lib/machines/protocol';
import { machineById, machineRole, operatorRole, receiverRoles, type LineDef } from '../../../lib/machines/line';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import { cancelDispatch } from './plan-shared';
import { jobOwns } from './jobs';
import { admit, hasRoom, jobRefusal, refuseUnfit, softwareRefusal } from './pacing';
import { readTrace } from './trace';
import { DISPATCH_STATE, ROW_END, type GatewayState, type HandoffRow } from './state';
import { standardRows, type HandoffRowAdapter } from '../rows';
import { planRegistrationRow, reachable } from './registration';

const VERB = { CREATED: 'created', CLAIMED: 'claimed', RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;

/** The stored status a row must have for each verb the gateway acts on. */
const STATUS_FOR_VERB: Record<string, string> = {
  [VERB.CREATED]: 'pending', [VERB.CLAIMED]: 'pending', [VERB.RESOLVED]: 'resolved', [VERB.CANCELLED]: 'cancelled', [VERB.EXPIRED]: 'expired',
};

/** The metadata key an accumulator row parked with an item limit carries. */
const ACCUMULATE_MAX = 'accumulate_max';

const LINE_ROW_TYPES: string[] = [ROW_TYPE.ALARM, ROW_TYPE.MACHINE_OFFLINE, ROW_TYPE.MACHINE_QUIET, ROW_TYPE.MACHINE_COMMAND, ROW_TYPE.MACHINE_REGISTRATION];

function handoffRow(id: string, role: string, facets: HandoffFacets, data?: Record<string, any>): HandoffRow {
  const metadata = data?.metadata;
  const capped = metadata?.[ACCUMULATE_MAX] != null;
  const createdAt = data?.created_at ? Date.parse(data.created_at) : NaN;
  return {
    ...facets, id, role, dispatch: DISPATCH_STATE.NONE, trace: readTrace(metadata),
    ...(capped ? { capped } : {}), ...(Number.isFinite(createdAt) ? { createdAt } : {}),
  };
}

/** Rows for another line belong to that line's gateway. */
function onThisLine(line: LineDef, at: { siteId?: unknown; lineId?: unknown }): boolean {
  return at.siteId === line.siteId && at.lineId === line.lineId;
}

/** Whether an event names a row this line acts on; only then is the stored row read. */
export function concernsLine(state: GatewayState, line: LineDef, event: EscalationEvent, rows: HandoffRowAdapter = standardRows): boolean {
  if (!STATUS_FOR_VERB[event.verb]) return false;
  if (state.get(event.escalationId)) return true;
  const facets = rows.toHandoff({ ...event.data, id: event.escalationId, role: event.role });
  if (facets) return onThisLine(line, facets);
  return LINE_ROW_TYPES.includes(event.data?.type) && onThisLine(line, event.data?.metadata ?? {});
}

/** Whether a stored row's status agrees with the event's verb, so a stale or invented event does nothing. */
export function statusFits(verb: string, status: unknown): boolean {
  return STATUS_FOR_VERB[verb] === status;
}

/** A handoff into a machine is parked on that machine's role; one to a person, on one of the line's receiver roles. */
function handoffRoleFits(line: LineDef, facets: HandoffFacets, role: string): boolean {
  if (onLine(line, facets.toMachine)) return role === machineRole(machineById(line, facets.toMachine));
  return receiverRoles(line).includes(role);
}

export function planEscalationEvent(
  state: GatewayState, line: LineDef, event: EscalationEvent, dispatchTtlMs: number, rows: HandoffRowAdapter = standardRows,
): Action[] {
  const view = { ...event.data, id: event.escalationId, role: event.role };
  const facets = rows.toHandoff(view);
  if (facets) return onThisLine(line, facets) && handoffRoleFits(line, facets, event.role) ? planHandoff(state, line, event, facets, dispatchTtlMs) : [];
  if (state.get(event.escalationId)) return planHandoff(state, line, event, null, dispatchTtlMs);
  const type = event.data?.type;
  if (!onThisLine(line, event.data?.metadata ?? {})) return [];
  if (type === ROW_TYPE.ALARM) return planAlarmRow(state, event);
  if (type === ROW_TYPE.MACHINE_OFFLINE || type === ROW_TYPE.MACHINE_QUIET) return planLinkRow(state, event);
  if (type === ROW_TYPE.MACHINE_COMMAND) return planCommandRow(state, line, event);
  if (type === ROW_TYPE.MACHINE_REGISTRATION) return event.role === operatorRole(line) ? planRegistrationRow(state, line, event) : [];
  return [];
}

/** Why the gateway will not send a command row's command; null when it will. */
function commandRefusal(state: GatewayState, line: LineDef, c: CommandFacets, role: string): string | null {
  if (!onLine(line, c.machineId)) return `${c.machineId} is not on ${line.siteId}/${line.lineId}`;
  const own = machineRole(machineById(line, c.machineId));
  if (role !== own) return `commands for ${c.machineId} are parked on ${own}, not ${role}`;
  if (!CONTROL_OPS.includes(c.op as Op)) return `${c.op} is not a command a row may ask for; one of ${CONTROL_OPS.join(', ')}`;
  if (c.op === OP.CANCEL && typeof c.args.jobId !== 'string') return `${OP.CANCEL} needs args.jobId, the job to withdraw or stop`;
  if (!reachable(state, line, c.machineId)) return `${c.machineId} has not registered an address yet`;
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
  const refusal = commandRefusal(state, line, c, event.role);
  if (refusal) {
    return [{ kind: 'resolve', as: CONTROLLER, rowId: id, payload: { accepted: false, machineId: c.machineId, op: c.op, status: COMMAND_STATUS.UNSUPPORTED, reason: refusal } }];
  }
  const createdAt = event.data?.created_at ? Date.parse(event.data.created_at) : NaN;
  return [{ kind: 'control', rowId: id, machineId: c.machineId, op: c.op, args: c.args, ...(Number.isFinite(createdAt) ? { createdAt } : {}) }];
}

function onLine(line: LineDef, machineId: string | null): machineId is string {
  return !!machineId && line.machines.some((m) => m.machineId === machineId);
}

function heldUnder(state: GatewayState, machineId: string, unitId: string, senderJobId: string | null): boolean {
  const held = state.heldJob(machineId, unitId);
  return !!held && (!senderJobId || jobOwns(senderJobId, held));
}

function planHandoff(state: GatewayState, line: LineDef, event: EscalationEvent, facets: HandoffFacets | null, dispatchTtlMs: number): Action[] {
  const id = event.escalationId;
  if (event.verb === VERB.CREATED || event.verb === VERB.CLAIMED) {
    if (state.isClosed(id) || !facets) return [];
    state.index(handoffRow(id, event.role, facets, event.data));
    const row = state.get(id)!;
    // The units now wait on the sender as this row's sender job, when the sender holds them under it.
    if (row.fromMachine) for (const u of row.units) if (heldUnder(state, row.fromMachine, u.unitId, row.senderJobId)) state.letGo(row.fromMachine, u.unitId);
    if (!onLine(line, row.toMachine) || row.dispatch !== DISPATCH_STATE.NONE) return [];
    // Read back already claimed: the machine accepted it before this gateway started.
    if (event.data?.assigned_to) {
      row.dispatch = DISPATCH_STATE.ACCEPTED;
      return [];
    }
    if (state.dispatchOnArrival) {
      const refused = refuseUnfit(state, line, row);
      if (!refused.length) row.dispatch = DISPATCH_STATE.ARRIVING;
      return refused;
    }
    const refused = !!softwareRefusal(state, line, row.toMachine) || !!jobRefusal(state, row);
    if (state.holdDispatch || (!refused && (!hasRoom(state, line, row) || !reachable(state, line, row.toMachine)))) {
      row.dispatch = DISPATCH_STATE.WAITING;
      return [];
    }
    return admit(state, line, row, dispatchTtlMs);
  }
  if (event.verb === VERB.CANCELLED || event.verb === VERB.EXPIRED) {
    const row = state.close(id, event.verb === VERB.CANCELLED ? ROW_END.CANCELLED : ROW_END.EXPIRED);
    return row ? cancelDispatch(state, row) : [];
  }
  if (event.verb === VERB.RESOLVED) state.close(id);
  return [];
}

function planAlarmRow(state: GatewayState, event: EscalationEvent): Action[] {
  const md = event.data.metadata ?? {};
  const track = state.alarms.get(state.alarmKey(md.machineId, md.alarmId));
  if (event.verb === VERB.CREATED) {
    // A row for an earlier raise of the same alarm id is not this raise's row.
    if (track && !track.rowId && (!track.raisedAt || !md.raisedAt || track.raisedAt === md.raisedAt)) track.rowId = event.escalationId;
    return [];
  }
  // Only the row of the raise still tracked speaks for it; an older row ending acknowledges nothing.
  if (!track || track.rowId !== event.escalationId || (event.verb !== VERB.RESOLVED && event.verb !== VERB.CANCELLED)) return [];
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
