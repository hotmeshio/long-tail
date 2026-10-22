/**
 * What the gateway knows: the open handoff rows (from escalation events, so a
 * replay rebuilds it), recently closed ones and how they ended (so replayed
 * machine events are recognized as done), open alarm rows, and each
 * machine's link: presence, last message, software and boot id.
 */

import type { HandoffFacets, TraceEntry } from '../contracts';
import { mergeTrace } from './trace';

/**
 * WAITING: the machine has no room yet (pacing.ts); the row waits in its role queue.
 * ARRIVING: the job goes out once its units arrive at the receiver (codec `dispatchOn: arrival`).
 */
export const DISPATCH_STATE = {
  NONE: 'none', WAITING: 'waiting', ARRIVING: 'arriving', PENDING: 'pending', ACCEPTED: 'accepted', REFUSED: 'refused',
} as const;
export type DispatchState = typeof DISPATCH_STATE[keyof typeof DISPATCH_STATE];

export const ROW_END = { RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;
export type RowEnd = typeof ROW_END[keyof typeof ROW_END];

export interface HandoffRow extends HandoffFacets {
  id: string;
  role: string;
  dispatch: DispatchState;
  ended?: RowEnd;
  /** Finished-unit records already on the row's metadata (trace.ts). */
  trace?: TraceEntry[];
  /** Each unit's arrival event, as its receiver reported it (dispatch on arrival). */
  arrivals?: Record<string, Record<string, any>>;
}

export interface AlarmTrack {
  machineId: string;
  alarmId: string;
  /** When the machine raised it; a reused alarm id with a new time is a new alarm. */
  raisedAt?: string;
  rowId?: string;
  /** Created and not yet resolved by anyone. */
  open: boolean;
}

export interface LinkTrack {
  online: boolean;
  since: number;
  lastSeen: number;
  rowId?: string;
  quietRowId?: string;
  watching?: boolean;
  software?: string;
  bootId?: string;
}

const CLOSED_LIMIT = 2_000;

export class GatewayState {
  /** Units one dispatch may carry, from the codec; null when any number may. */
  unitsPerDispatch: number | null = null;
  /** Jobs go to a receiver once its units arrive there, from the codec. */
  dispatchOnArrival = false;
  /** While reconciling, new handoffs wait so pacing sees the whole line before anything is sent. */
  holdDispatch = false;
  /** Units at each machine that arrived and have not left: machine → unit → job. */
  private held = new Map<string, Map<string, string>>();
  private openRows = new Map<string, HandoffRow>();
  private closedRows = new Map<string, HandoffRow>();
  readonly alarms = new Map<string, AlarmTrack>();
  /** Finished records that came before their row: machine/unit → job body. */
  private earlyFinishes = new Map<string, Record<string, any>>();
  private openCommands = new Set<string>();
  /** Accepted dispatch command ids → their row, so a later failure finds the row. */
  private dispatches = new Map<string, string>();
  private endedCommands = new Set<string>();
  readonly links = new Map<string, LinkTrack>();
  /** Messages already shown to a person as contract violations. */
  private violations = new Set<string>();

  index(row: HandoffRow): void {
    if (this.closedRows.has(row.id)) return;
    const existing = this.openRows.get(row.id);
    // An event may carry metadata older than what the gateway already wrote: keep both traces.
    this.openRows.set(row.id, existing
      ? { ...row, dispatch: existing.dispatch, trace: mergeTrace(row.trace, existing.trace), arrivals: existing.arrivals }
      : row);
  }

  get(id: string): HandoffRow | undefined {
    return this.openRows.get(id);
  }

  close(id: string, ended: RowEnd = ROW_END.RESOLVED): HandoffRow | undefined {
    const row = this.openRows.get(id);
    if (!row) return undefined;
    this.openRows.delete(id);
    row.ended = ended;
    this.closedRows.set(id, row);
    if (this.closedRows.size > CLOSED_LIMIT) {
      const oldest = this.closedRows.keys().next().value;
      if (oldest) this.closedRows.delete(oldest);
    }
    return row;
  }

  isClosed(id: string): boolean {
    return this.closedRows.has(id);
  }

  open(): HandoffRow[] {
    return [...this.openRows.values()];
  }

  /** The open handoff carrying this unit that `pred` picks (latest attempt first). */
  openFor(unitId: string, pred: (r: HandoffRow) => boolean): HandoffRow | undefined {
    return this.open().filter((r) => carries(r, unitId) && pred(r)).sort((a, b) => b.attempt - a.attempt)[0];
  }

  closedFor(unitId: string, pred: (r: HandoffRow) => boolean): HandoffRow | undefined {
    return [...this.closedRows.values()].find((r) => carries(r, unitId) && pred(r));
  }

  hold(machineId: string, unitId: string, jobId: string): void {
    if (!this.held.has(machineId)) this.held.set(machineId, new Map());
    this.held.get(machineId)!.set(unitId, jobId);
  }

  letGo(machineId: string, unitId: string): void {
    this.held.get(machineId)?.delete(unitId);
  }

  heldAt(machineId: string): string[] {
    return [...(this.held.get(machineId)?.values() ?? [])];
  }

  /** Keep only units whose job the machine still lists (its snapshot). */
  keepHeld(machineId: string, jobIds: Set<string>): void {
    const units = this.held.get(machineId);
    if (!units) return;
    for (const [unitId, jobId] of units) if (!jobIds.has(jobId)) units.delete(unitId);
  }

  /** Keep a sender's finished record until its row is known, so an arrival cannot close the row without it. */
  rememberFinish(machineId: string, unitId: string, body: Record<string, any>): void {
    this.earlyFinishes.delete(`${machineId}/${unitId}`);
    this.earlyFinishes.set(`${machineId}/${unitId}`, body);
    if (this.earlyFinishes.size > CLOSED_LIMIT) {
      const oldest = this.earlyFinishes.keys().next().value;
      if (oldest) this.earlyFinishes.delete(oldest);
    }
  }

  takeFinish(machineId: string, unitId: string): Record<string, any> | undefined {
    const body = this.earlyFinishes.get(`${machineId}/${unitId}`);
    this.earlyFinishes.delete(`${machineId}/${unitId}`);
    return body;
  }

  rememberDispatch(cmdId: string, rowId: string): void {
    this.dispatches.set(cmdId, rowId);
    if (this.dispatches.size > CLOSED_LIMIT) {
      const oldest = this.dispatches.keys().next().value;
      if (oldest) this.dispatches.delete(oldest);
    }
  }

  /** The open row an accepted dispatch command belongs to. */
  rowForDispatch(cmdId: string): HandoffRow | undefined {
    const rowId = this.dispatches.get(cmdId);
    return rowId ? this.openRows.get(rowId) : undefined;
  }

  /** Track a machine-command row; false when it is already tracked or has ended. */
  trackCommand(id: string): boolean {
    if (this.openCommands.has(id) || this.endedCommands.has(id)) return false;
    this.openCommands.add(id);
    return true;
  }

  endCommand(id: string): void {
    this.openCommands.delete(id);
    this.endedCommands.add(id);
    if (this.endedCommands.size > CLOSED_LIMIT) {
      const oldest = this.endedCommands.values().next().value;
      if (oldest) this.endedCommands.delete(oldest);
    }
  }

  violationRaised(key: string): boolean {
    return this.violations.has(key);
  }

  raiseViolation(key: string): void {
    this.violations.add(key);
    if (this.violations.size > CLOSED_LIMIT) {
      const oldest = this.violations.values().next().value;
      if (oldest) this.violations.delete(oldest);
    }
  }

  link(machineId: string, now = Date.now()): LinkTrack {
    let link = this.links.get(machineId);
    if (!link) {
      link = { online: true, since: now, lastSeen: now };
      this.links.set(machineId, link);
    }
    return link;
  }

  alarmKey(machineId: string, alarmId: string): string {
    return `${machineId}/${alarmId}`;
  }
}

function carries(row: HandoffRow, unitId: string): boolean {
  return row.units.some((u) => u.unitId === unitId);
}
