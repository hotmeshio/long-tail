import type { MachineView } from '../../api/machines';

/** How the machines region lists its machines. */
export const MACHINE_VIEWS = ['tiles', 'rows'] as const;
export type MachineViewMode = (typeof MACHINE_VIEWS)[number];
export const MACHINE_VIEW_LABEL: Record<MachineViewMode, string> = { tiles: 'Tiles', rows: 'Rows' };

/** Tiles read well to a dozen machines; beyond that, rows. */
export const TILES_MAX = 12;

export function machineViewStorageKey(siteId: string, lineId: string): string {
  return `lt:lines:${siteId}/${lineId}:machines-view`;
}

export function autoMachineView(count: number): MachineViewMode {
  return count <= TILES_MAX ? 'tiles' : 'rows';
}

export function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = localStorage.getItem(key);
    return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage may be unavailable; the choice then lasts the session
  }
}

/** A machine that needs a person: offline, quiet, an active alarm, or an open row. */
export function needsAttention(view: MachineView | undefined): boolean {
  if (!view) return false;
  if (view.online === false) return true;
  if (view.rows.offlineRowId || view.rows.quietRowId) return true;
  if (view.alarms.length > 0) return true;
  return view.rows.handoff + view.rows.command + view.rows.alarm > 0;
}
