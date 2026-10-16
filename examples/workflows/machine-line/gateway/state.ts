/**
 * What the gateway knows: the open handoff rows (from escalation events, so a
 * replay rebuilds it), recently closed ones and how they ended (so replayed
 * machine events are recognized as done), open alarm rows, and each
 * machine's link: presence, last message, software and boot id.
 */

import type { HandoffFacets } from '../contracts';

export const DISPATCH_STATE = { NONE: 'none', PENDING: 'pending', ACCEPTED: 'accepted', REFUSED: 'refused' } as const;
export type DispatchState = typeof DISPATCH_STATE[keyof typeof DISPATCH_STATE];

export const ROW_END = { RESOLVED: 'resolved', CANCELLED: 'cancelled', EXPIRED: 'expired' } as const;
export type RowEnd = typeof ROW_END[keyof typeof ROW_END];

export interface HandoffRow extends HandoffFacets {
  id: string;
  role: string;
  dispatch: DispatchState;
  ended?: RowEnd;
}

export interface AlarmTrack {
  machineId: string;
  alarmId: string;
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
  private openRows = new Map<string, HandoffRow>();
  private closedRows = new Map<string, HandoffRow>();
  readonly alarms = new Map<string, AlarmTrack>();
  readonly links = new Map<string, LinkTrack>();

  index(row: HandoffRow): void {
    if (this.closedRows.has(row.id)) return;
    const existing = this.openRows.get(row.id);
    this.openRows.set(row.id, existing ? { ...row, dispatch: existing.dispatch } : row);
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
