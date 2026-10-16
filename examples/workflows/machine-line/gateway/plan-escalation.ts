/**
 * Escalation events to gateway actions. A new handoff row for a machine is the
 * cue to dispatch, exactly as a new row is the cue for a person to look at the
 * dashboard. Ended rows withdraw their dispatch; an alarm row a person
 * resolves acknowledges the alarm at the machine.
 */

import { ROW_TYPE, dispatchCommandId, type HandoffFacets } from '../contracts';
import { OP, isoTs } from '../protocol';
import type { LineDef } from '../line';
import type { EscalationEvent } from '../transport';
import type { Action } from './actions';
import { cancelDispatch } from './plan-shared';
import { DISPATCH_STATE, type GatewayState, type HandoffRow } from './state';

const VERB = { CREATED: 'created', CLAIMED: 'claimed', RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;

export function handoffFromEvent(data: Record<string, any>): HandoffRow {
  const md: Partial<HandoffFacets> = data.metadata ?? {};
  return {
    id: data.id,
    role: data.role,
    unitId: String(md.unitId),
    jobId: String(md.jobId),
    carrierId: md.carrierId ?? null,
    orderRef: String(md.orderRef ?? ''),
    fromMachine: md.fromMachine ?? null,
    toMachine: md.toMachine ?? null,
    recipeId: md.recipeId ?? null,
    recipeVersion: md.recipeVersion ?? null,
    process: md.process ?? null,
    artifactUrl: md.artifactUrl ?? null,
    artifactSha256: md.artifactSha256 ?? null,
    attempt: Number(md.attempt ?? 1),
    dispatch: DISPATCH_STATE.NONE,
  };
}

/** Dispatch arguments for a handoff row. */
export function dispatchArgs(row: HandoffRow, expiresAt: number): Record<string, any> {
  return {
    jobId: row.jobId,
    unitId: row.unitId,
    orderRef: row.orderRef,
    recipe: { id: row.recipeId, version: row.recipeVersion },
    carrierId: row.carrierId,
    from: row.fromMachine,
    expiresAt: isoTs(expiresAt),
    ...(row.artifactUrl ? { artifact: { url: row.artifactUrl, sha256: row.artifactSha256 } } : {}),
  };
}

export function planEscalationEvent(state: GatewayState, line: LineDef, event: EscalationEvent, dispatchTtlMs: number): Action[] {
  const type = event.data?.type;
  if (type === ROW_TYPE.HANDOFF) return planHandoff(state, line, event, dispatchTtlMs);
  if (type === ROW_TYPE.ALARM) return planAlarmRow(state, event);
  if (type === ROW_TYPE.MACHINE_OFFLINE) return planOfflineRow(state, event);
  return [];
}

function onLine(line: LineDef, machineId: string | null): machineId is string {
  return !!machineId && line.machines.some((m) => m.machineId === machineId);
}

function planHandoff(state: GatewayState, line: LineDef, event: EscalationEvent, dispatchTtlMs: number): Action[] {
  const id = event.escalationId;
  if (event.verb === VERB.CREATED || event.verb === VERB.CLAIMED) {
    if (state.isClosed(id)) return [];
    state.index(handoffFromEvent({ ...event.data, id, role: event.role }));
    const row = state.get(id)!;
    if (!onLine(line, row.toMachine) || row.dispatch !== DISPATCH_STATE.NONE) return [];
    row.dispatch = DISPATCH_STATE.PENDING;
    return [{ kind: 'dispatch', rowId: id, machineId: row.toMachine, cmdId: dispatchCommandId(id), args: dispatchArgs(row, Date.now() + dispatchTtlMs) }];
  }
  if (event.verb === VERB.CANCELLED || event.verb === VERB.EXPIRED) {
    const row = state.close(id);
    return row ? cancelDispatch(row) : [];
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

function planOfflineRow(state: GatewayState, event: EscalationEvent): Action[] {
  const machineId = event.data.metadata?.machineId;
  const link = machineId ? state.links.get(machineId) : undefined;
  if (!link) return [];
  if (event.verb === VERB.CREATED) link.rowId = event.escalationId;
  if (event.verb === VERB.RESOLVED || event.verb === VERB.CANCELLED) link.rowId = undefined;
  return [];
}
