/**
 * What a gateway restores when it starts leading a line: the alarm, offline
 * and quiet rows it raised before, read back from Long Tail, so a clear or a
 * return that comes later still resolves them.
 */

import { ROW_TYPE } from '../contracts';
import { operatorRole, type LineDef } from '../../../lib/machines/line';
import type { LineEscalations } from './escalations';
import type { GatewayState } from './state';

export interface RestoredRows {
  alarms: number;
  offline: number;
  quiet: number;
}

export async function restoreLineRows(state: GatewayState, lt: LineEscalations, line: LineDef): Promise<RestoredRows> {
  const role = operatorRole(line);
  const mine = (row: Record<string, any>) => row.metadata?.siteId === line.siteId && row.metadata?.lineId === line.lineId && row.metadata?.machineId;
  const [alarms, offline, quiet] = await Promise.all(
    [ROW_TYPE.ALARM, ROW_TYPE.MACHINE_OFFLINE, ROW_TYPE.MACHINE_QUIET].map(async (type) => (await lt.listOpen({ type, role })).filter(mine)),
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
  return { alarms: alarms.length, offline: offline.length, quiet: quiet.length };
}

/** Alarm rows whose alarm the machine no longer holds: it cleared while no gateway was listening. */
export function alarmsClearedMeanwhile(state: GatewayState, active: Set<string>): { key: string; rowId: string; machineId: string }[] {
  return [...state.alarms.entries()]
    .filter(([key, t]) => t.open && t.rowId && !active.has(key))
    .map(([key, t]) => ({ key, rowId: t.rowId!, machineId: t.machineId }));
}
