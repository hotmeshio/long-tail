/**
 * What happens at the machine itself: breakdowns, emergency stops, an
 * operator's reset, and maintenance windows.
 */

import { LEVEL, MODE } from '../../../../lib/machines/protocol';
import type { MockMachine } from './machine';

export async function fault(m: MockMachine, input: { code: string }): Promise<string> {
  const text = m.def.faults[input.code] ?? 'Unlisted fault';
  const alarm = await m.alarms.raise(input.code, LEVEL.CRITICAL, text, {
    autoClears: false, action: 'Repair, then end the maintenance window', jobId: m.cell.station?.jobId ?? null,
  });
  await m.cell.interrupt(input.code);
  await m.setMode(MODE.FAULTED);
  return alarm.alarmId;
}

export async function emergencyStop(m: MockMachine): Promise<string> {
  const alarm = await m.alarms.raise('E-STOP', LEVEL.EMERGENCY, 'Emergency stop engaged', {
    autoClears: false, action: 'Make the machine safe, then reset', jobId: m.cell.station?.jobId ?? null,
  });
  await m.cell.interrupt('E-STOP');
  await m.setMode(MODE.EMERGENCY_STOP);
  return alarm.alarmId;
}

/** An operator resets the machine after an emergency stop; the reset names them. */
export async function reset(m: MockMachine, by: string | null = null): Promise<void> {
  await m.alarms.clearWhere((a) => a.level === LEVEL.EMERGENCY, by);
  if (m.mode === MODE.EMERGENCY_STOP) await m.setMode(MODE.IDLE);
  await m.resumeWork();
}

export async function clearAlarm(m: MockMachine, alarmId: string, by: string | null = null): Promise<boolean> {
  const cleared = await m.alarms.clear(alarmId, by);
  if (cleared) await m.resumeWork();
  return cleared;
}

export async function maintenanceStart(m: MockMachine): Promise<void> {
  await m.setMode(MODE.MAINTENANCE);
}

/** The window closes; a repair clears the critical alarms that opened it. */
export async function maintenanceEnd(m: MockMachine, by: string | null = null): Promise<void> {
  await m.alarms.clearWhere((a) => a.level === LEVEL.CRITICAL, by);
  await m.setMode(MODE.IDLE);
  await m.resumeWork();
}
