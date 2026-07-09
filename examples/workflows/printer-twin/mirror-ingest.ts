/**
 * Poll ingestion — the pure helpers that fold a Bambu poll snapshot into the
 * mirror (poll wins every physical field) and classify health. Kept apart from
 * the phase machine (reconcile.ts) so both stay small and independently tested.
 */

import {
  FILAMENT_HMS,
  OFFLINE_STRIKES,
  type Mirror,
  type BambuDeviceSnapshot,
  type BambuHms,
  type HmsClass,
} from './mirror';

/** Classify the hms[] by its signature. Filament runout is the one we act on. */
export function classifyHms(hms: BambuHms[]): HmsClass {
  if (!hms || hms.length === 0) return 'none';
  if (hms.some((h) => h.attr === FILAMENT_HMS.attr && h.code === FILAMENT_HMS.code)) return 'filament';
  return 'fault';
}

/**
 * Overwrite every physical field from a successful poll — poll is authoritative.
 * Debounces offline: `consecutiveOfflinePolls` only crosses the strike threshold
 * after N successive online=false reads, riding out WiFi blips.
 */
export function applySnapshot(m: Mirror, snap: BambuDeviceSnapshot, nowIso: string): void {
  m.sn = snap.sn || m.sn;
  m.model = snap.model || m.model;
  m.bound = snap.bound;
  m.online = snap.online;
  m.consecutiveOfflinePolls = snap.online ? 0 : m.consecutiveOfflinePolls + 1;

  const rs = snap.reportStatus;
  m.gcodeState = rs.gcode_state;
  m.mcPercent = rs.mc_percent;
  m.mcRemainingTime = rs.mc_remaining_time;
  m.layerNum = rs.layer_num;
  m.totalLayerNum = rs.total_layer_num;
  m.gcodeFile = rs.gcode_file;
  m.subtaskName = rs.subtask_name;
  m.taskId = rs.task_id;
  m.hms = rs.hms ?? [];
  m.hmsClass = classifyHms(m.hms);
  m.lastSeenAt = nowIso;
}

/** True once the offline debounce has tripped — the machine is really gone. */
export function isOfflineConfirmed(m: Mirror): boolean {
  return !m.online && m.consecutiveOfflinePolls >= OFFLINE_STRIKES;
}

/**
 * Clear `pendingCommand` when the poll shows the state it expected. Idempotent —
 * a command re-issued after the state already flipped is a harmless no-op the
 * mock rejects, and this confirms it either way.
 */
export function confirmPending(m: Mirror): void {
  const pc = m.pendingCommand;
  if (!pc) return;
  const met =
    (pc.expect === 'BOUND' && m.bound) ||
    (pc.expect === 'UNBOUND' && !m.bound) ||
    (pc.expect === m.gcodeState);
  if (met) m.pendingCommand = null;
}

/** Move to a new phase, stamping when we entered (drives stuck-state timers). */
export function enterPhase(m: Mirror, phase: Mirror['phase'], now: number): void {
  if (m.phase !== phase) {
    m.phase = phase;
    m.phaseEnteredAt = now;
  }
}

/** Seconds the mirror has sat in its current phase. */
export function secondsInPhase(m: Mirror, now: number): number {
  return (now - m.phaseEnteredAt) / 1000;
}
