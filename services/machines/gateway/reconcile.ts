/**
 * What a gateway restores when it starts leading a line, read back from Long
 * Tail: the alarm, offline and quiet rows it raised before, so a clear or a
 * return that comes later still resolves them; and the units each open
 * handoff saw arrive, so the receiver holds them again.
 */

import { ROW_TYPE, arrivedUnit, handoffProgress } from '../contracts';
import { learnsAddress, operatorRole, type LineDef } from '../../../lib/machines/line';
import type { AddressBook } from './address-book';
import type { Action } from './actions';
import type { LineEscalations } from './escalations';
import { dispatchJobs } from './jobs';
import { dispatchAction, latestArrival } from './pacing';
import { DISPATCH_STATE, type GatewayState } from './state';

export interface RestoredRows {
  alarms: number;
  offline: number;
  quiet: number;
  registrations: number;
}

export async function restoreLineRows(state: GatewayState, lt: LineEscalations, line: LineDef): Promise<RestoredRows> {
  const role = operatorRole(line);
  const mine = (row: Record<string, any>) => row.metadata?.siteId === line.siteId && row.metadata?.lineId === line.lineId && row.metadata?.machineId;
  const [alarms, offline, quiet, registrations] = await Promise.all(
    [ROW_TYPE.ALARM, ROW_TYPE.MACHINE_OFFLINE, ROW_TYPE.MACHINE_QUIET, ROW_TYPE.MACHINE_REGISTRATION]
      .map(async (type) => (await lt.listOpen({ type, role })).filter(mine)),
  );
  for (const row of alarms) {
    const { machineId, alarmId, raisedAt } = row.metadata;
    state.alarms.set(state.alarmKey(machineId, alarmId), { machineId, alarmId, raisedAt, rowId: row.id, open: true });
  }
  for (const row of offline) {
    const link = state.link(row.metadata.machineId);
    link.online = false;
    link.rowId = row.id;
  }
  for (const row of quiet) state.link(row.metadata.machineId).quietRowId = row.id;
  for (const row of registrations) state.raiseClaim(row.metadata.address, row.metadata.machineId);
  return { alarms: alarms.length, offline: offline.length, quiet: quiet.length, registrations: registrations.length };
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
