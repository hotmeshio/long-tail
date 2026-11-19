/**
 * What a gateway restores when it starts leading a line, read back from Long
 * Tail: the alarm, offline and quiet rows it raised before, the hold rows that
 * keep a machine from dispatch, so a clear or a
 * return that comes later still resolves them; the units each open handoff
 * saw arrive, so the receiver holds them again; and the jobs recent handoffs
 * sent, so a restarted machine gets them back.
 */

import { ROW_TYPE, arrivedUnit, handoffProgress } from '../contracts';
import { readAnswer } from '../requests';
import { learnsAddress, operatorRole, type LineDef } from '../../../lib/machines/line';
import type { AddressBook } from './address-book';
import { CONTROLLER, type Action } from './actions';
import { overdueDecision, trackRequest } from './plan-request';
import { resolverPayloadOf, type LineEscalations } from './escalations';
import { dispatchJobs } from './jobs';
import { dispatchAction, latestArrival } from './pacing';
import type { HandoffRowAdapter } from '../rows';
import { readTrace } from './trace';
import { DISPATCH_STATE, ROW_END, type GatewayState, type HandoffRow } from './state';

export interface RestoredRows {
  alarms: number;
  offline: number;
  quiet: number;
  registrations: number;
  holds: number;
}

export async function restoreLineRows(state: GatewayState, lt: LineEscalations, line: LineDef): Promise<RestoredRows> {
  const role = operatorRole(line);
  const mine = (row: Record<string, any>) => row.metadata?.siteId === line.siteId && row.metadata?.lineId === line.lineId && row.metadata?.machineId;
  const [alarms, offline, quiet, registrations] = await Promise.all(
    [ROW_TYPE.ALARM, ROW_TYPE.MACHINE_OFFLINE, ROW_TYPE.MACHINE_QUIET, ROW_TYPE.MACHINE_REGISTRATION]
      .map(async (type) => (await lt.listOpen({ type, role })).filter(mine)),
  );
  for (const row of alarms) {
    const { machineId, alarmId, raisedAt, level } = row.metadata;
    state.alarms.set(state.alarmKey(machineId, alarmId), { machineId, alarmId, raisedAt, level, rowId: row.id, open: true });
  }
  for (const row of offline) {
    const link = state.link(row.metadata.machineId);
    link.online = false;
    link.rowId = row.id;
  }
  for (const row of quiet) state.link(row.metadata.machineId).quietRowId = row.id;
  for (const row of registrations) state.raiseClaim(row.metadata.address, row.metadata.machineId, row.id);
  const holds = (await lt.listOpen({ type: ROW_TYPE.MACHINE_HOLD }))
    .filter((row) => mine(row) && line.machines.some((m) => m.machineId === row.metadata.machineId));
  for (const row of holds) state.holdRows.set(row.id, row.metadata.machineId);
  return { alarms: alarms.length, offline: offline.length, quiet: quiet.length, registrations: registrations.length, holds: holds.length };
}

/** Ended handoffs read back on taking the line, newest first. */
export const ENDED_READ = 500;

/**
 * The line's recently received handoffs, so a machine that restarts after a
 * takeover is sent the jobs it lost: each job the receiver took is remembered
 * by the row that sent it, and a replayed event for the row is known as done.
 */
export async function restoreSentJobs(state: GatewayState, lt: LineEscalations, line: LineDef, rows: HandoffRowAdapter): Promise<number> {
  const facets = { siteId: line.siteId, lineId: line.lineId };
  let restored = 0;
  for (const query of rows.openRows(line)) {
    const ended = await lt.listEnded({ ...query, facets, limit: ENDED_READ });
    // Oldest first, so a later row for the same job is the one remembered.
    for (const data of ended.reverse()) {
      const handoff = rows.toHandoff({ ...data, id: data.id, role: data.role });
      if (!handoff || handoff.siteId !== line.siteId || handoff.lineId !== line.lineId) continue;
      const createdAt = data.created_at ? new Date(data.created_at).getTime() : NaN;
      const row: HandoffRow = {
        ...handoff, id: data.id, role: data.role, dispatch: DISPATCH_STATE.ACCEPTED, ended: ROW_END.RESOLVED, trace: readTrace(data.metadata),
        ...(Number.isFinite(createdAt) ? { createdAt } : {}),
      };
      state.restoreClosed(row);
      const m = row.toMachine;
      if (!m || !line.machines.some((d) => d.machineId === m) || resolverPayloadOf(data).received !== true) continue;
      for (const job of dispatchJobs(row.jobId, row.units, state.unitsPerDispatch)) state.rememberSent(m, job.jobId, row.id);
      restored++;
    }
  }
  return restored;
}

/** The addresses the line learned before, for the stations that still learn theirs. */
export async function restoreAddresses(state: GatewayState, book: AddressBook, line: LineDef): Promise<number> {
  let restored = 0;
  for (const [machineId, address] of await book.load()) {
    if (!learnsAddress(line, machineId)) continue;
    state.bindAddress(machineId, address);
    restored++;
  }
  return restored;
}

/** Alarm rows whose alarm the machine no longer holds: it cleared while no gateway was listening. */
export function alarmsClearedMeanwhile(state: GatewayState, active: Set<string>): { key: string; rowId: string; machineId: string }[] {
  return [...state.alarms.entries()]
    .filter(([key, t]) => t.open && t.rowId && !active.has(key))
    .map(([key, t]) => ({ key, rowId: t.rowId!, machineId: t.machineId }));
}

/**
 * Units that arrived at an open handoff's receiver, read from the row's items:
 * the receiver holds them again, so a timeout leaves their job alone. A row
 * whose units all arrived completes; one dispatched on arrival is sent with the
 * arrivals it holds.
 */
export async function arrivalsOnRows(state: GatewayState, lt: LineEscalations, dispatchTtlMs: number): Promise<Action[]> {
  const actions: Action[] = [];
  for (const row of state.open()) {
    const to = row.toMachine;
    if (!to || (row.dispatch !== DISPATCH_STATE.ARRIVING && row.dispatch !== DISPATCH_STATE.ACCEPTED)) continue;
    const items = await lt.items(row.id);
    row.noted = items.map((i) => i.itemKey);
    const units = row.units.map((u) => u.unitId);
    const { arrived, missing } = handoffProgress(units, items);
    for (const job of dispatchJobs(row.jobId, row.units, state.unitsPerDispatch)) {
      for (const u of job.units) if (arrived.includes(u.unitId)) state.hold(to, u.unitId, job.jobId);
    }
    if (missing.length) continue;
    if (row.dispatch === DISPATCH_STATE.ACCEPTED) {
      actions.push({ kind: 'resolve', as: to, rowId: row.id, payload: { received: true, receiver: to, units } });
      continue;
    }
    const byUnit = new Map(items.filter((i) => arrivedUnit(i.itemKey)).map((i) => [i.payload.unitId, i.payload]));
    row.arrivals = Object.fromEntries(units.map((u) => [u, byUnit.get(u)?.arrival ?? { unitId: u, carrierId: byUnit.get(u)?.carrierId ?? null }]));
    for (const arrival of byUnit.values()) row.dueAt = latestArrival(row.dueAt, arrival.at);
    actions.push(dispatchAction(row, to, dispatchTtlMs));
  }
  return actions;
}

/** With lifecycle notes on, the items each handoff out of a machine already holds, so a restart notes nothing twice. */
export async function notesOnRows(state: GatewayState, lt: LineEscalations): Promise<void> {
  if (!state.lifecycle) return;
  for (const row of state.open()) {
    if (row.fromMachine && !row.noted) row.noted = (await lt.items(row.id)).map((i) => i.itemKey);
  }
}

/**
 * The line's open machine requests and their overdue rows. A request that holds
 * its answer is answered now; one with a window is watched again from its
 * creation. An overdue row whose request has ended is closed.
 */
export async function restoreRequests(state: GatewayState, lt: LineEscalations, line: LineDef): Promise<{ open: number; actions: Action[] }> {
  const mine = (row: Record<string, any>) => row.metadata?.siteId === line.siteId && row.metadata?.lineId === line.lineId;
  const actions: Action[] = [];
  const requests = (await lt.listOpen({ type: ROW_TYPE.MACHINE_REQUEST })).filter(mine);
  for (const row of requests) {
    const track = trackRequest(state, row.id, ROW_TYPE.MACHINE_REQUEST, row.metadata, row.created_at);
    if (!track) continue;
    if (readAnswer(await lt.items(row.id))) {
      track.sending = true;
      actions.push({ kind: 'answer', rowId: row.id });
    }
  }
  const notices = (await lt.listOpen({ type: ROW_TYPE.MACHINE_NOTICE })).filter(mine);
  for (const row of notices) trackRequest(state, row.id, ROW_TYPE.MACHINE_NOTICE, row.metadata, row.created_at);
  for (const row of (await lt.listOpen({ type: ROW_TYPE.REQUEST_OVERDUE, role: operatorRole(line) })).filter(mine)) {
    const track = state.requests.get(row.metadata?.requestId);
    if (!track) {
      const decision = overdueDecision(row.metadata?.rowType);
      actions.push({ kind: 'resolve', as: CONTROLLER, rowId: row.id, payload: { decision, note: `${row.metadata?.rowType ?? 'request'} ${row.metadata?.requestId} has ended` } });
      continue;
    }
    track.overdue = true;
    track.overdueRowId = row.id;
  }
  for (const track of state.requests.values()) if (track.withinMs && !track.overdue) actions.push({ kind: 'watchLate', rowId: track.rowId });
  return { open: requests.length + notices.length, actions };
}
