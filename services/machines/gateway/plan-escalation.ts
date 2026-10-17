/**
 * Escalation events to gateway actions. A new handoff row for a machine is the
 * cue to dispatch, exactly as a new row is the cue for a person to look at the
 * dashboard. A cancelled row stops both sides; an expired one withdraws its
 * dispatch; an alarm row a person resolves acknowledges the alarm at the machine.
 */

import { HANDOFF_ERROR, ROW_TYPE, dispatchCommandId, type HandoffFacets } from '../contracts';
import { OP, isoTs } from '../../../lib/machines/protocol';
import { machineById, type LineDef } from '../../../lib/machines/line';
import type { EscalationEvent } from '../../../lib/machines/transport';
import { CONTROLLER, type Action } from './actions';
import { cancelDispatch, cancelSender } from './plan-shared';
import { DISPATCH_STATE, ROW_END, type GatewayState, type HandoffRow } from './state';
import { standardRows, type HandoffRowAdapter } from '../rows';

const VERB = { CREATED: 'created', CLAIMED: 'claimed', RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;

function handoffRow(id: string, role: string, facets: HandoffFacets): HandoffRow {
  return { ...facets, id, role, dispatch: DISPATCH_STATE.NONE };
}

/** Dispatch arguments for a handoff row. */
export function dispatchArgs(row: HandoffRow, expiresAt: number): Record<string, any> {
  return {
    jobId: row.jobId,
    orderRef: row.orderRef,
    recipe: { id: row.recipeId, version: row.recipeVersion },
    units: row.units,
    process: row.process,
    from: row.fromMachine,
    expiresAt: isoTs(expiresAt),
    ...(row.artifactUrl ? { artifact: { url: row.artifactUrl, sha256: row.artifactSha256 } } : {}),
  };
}

export function dispatchAction(row: HandoffRow, machineId: string, dispatchTtlMs: number): Action {
  return { kind: 'dispatch', rowId: row.id, machineId, cmdId: dispatchCommandId(row.id), args: dispatchArgs(row, Date.now() + dispatchTtlMs) };
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
  return [];
}

function onLine(line: LineDef, machineId: string | null): machineId is string {
  return !!machineId && line.machines.some((m) => m.machineId === machineId);
}

/** A machine on a version the line does not allow is refused before any dispatch. */
function softwareRefusal(state: GatewayState, line: LineDef, machineId: string): string | null {
  const allowed = machineById(line, machineId).allowedSoftware;
  const software = state.links.get(machineId)?.software;
  if (!allowed || !software || allowed.includes(software)) return null;
  return `${machineId} runs ${software}; allowed: ${allowed.join(', ')}`;
}

function planHandoff(state: GatewayState, line: LineDef, event: EscalationEvent, facets: HandoffFacets | null, dispatchTtlMs: number): Action[] {
  const id = event.escalationId;
  if (event.verb === VERB.CREATED || event.verb === VERB.CLAIMED) {
    if (state.isClosed(id) || !facets) return [];
    state.index(handoffRow(id, event.role, facets));
    const row = state.get(id)!;
    if (!onLine(line, row.toMachine) || row.dispatch !== DISPATCH_STATE.NONE) return [];
    // Read back already claimed: the machine accepted it before this gateway started.
    if (event.data?.assigned_to) {
      row.dispatch = DISPATCH_STATE.ACCEPTED;
      return [];
    }
    const refusal = softwareRefusal(state, line, row.toMachine);
    if (refusal) {
      row.dispatch = DISPATCH_STATE.REFUSED;
      return [{ kind: 'resolve', as: CONTROLLER, rowId: id, payload: { received: false, errorCode: HANDOFF_ERROR.SOFTWARE_UNSUPPORTED, detail: refusal } }];
    }
    row.dispatch = DISPATCH_STATE.PENDING;
    return [dispatchAction(row, row.toMachine, dispatchTtlMs)];
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
    kind: 'command', machineId: track.machineId, op: OP.ACK_ALARM, cmdId: `${event.escalationId}:ack`,
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
