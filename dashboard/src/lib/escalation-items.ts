import type { LTEscalationRecord } from '../api/types';

/** One held item of an accumulator or batch row, in the shape the workflow receives. */
export interface EscalationItem {
  itemKey: string;
  payload?: Record<string, unknown>;
  /** ISO-8601 from the database clock; empty for a batch item with no stamp. */
  at: string;
  actor?: string;
  reciprocalId?: string;
}

export interface EscalationItems {
  kind: 'accumulate' | 'batch';
  count: number;
  /** The count trigger (accumulate) or the declared size (batch); null when unbounded. */
  max: number | null;
  items: EscalationItem[];
  /** Batch only: declared keys still awaiting submission. */
  pending: string[];
}

const ACCUMULATE_ITEMS = 'accumulate_items';
const ACCUMULATE_MAX = 'accumulate_max';
const BATCH_ITEMS = 'batch_items';
const BATCH_FILLED_AT = 'batch_filled_at';
const BATCH_KEYS = 'batch_keys';
const BATCH_PENDING = 'batch_pending';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function byArrival(a: EscalationItem, b: EscalationItem): number {
  return a.at.localeCompare(b.at) || a.itemKey.localeCompare(b.itemKey);
}

/**
 * The held items of a row, or null when the row is neither an accumulator
 * nor a batch. Mirrors the server's items view so the panel and the API
 * agree on order (arrival, then key).
 */
export function escalationItems(
  esc: Pick<LTEscalationRecord, 'metadata'>,
  envelope: Record<string, unknown> | null,
): EscalationItems | null {
  const metadata = (esc.metadata ?? {}) as Record<string, unknown>;
  const store = envelope?.[ACCUMULATE_ITEMS];
  if (isRecord(store)) {
    const items = Object.entries(store).map(([itemKey, entry]) => {
      const e = isRecord(entry) ? entry : {};
      return {
        itemKey,
        at: typeof e.at === 'string' ? e.at : '',
        ...(isRecord(e.payload) ? { payload: e.payload } : {}),
        ...(typeof e.actor === 'string' ? { actor: e.actor } : {}),
        ...(typeof e.reciprocalId === 'string' ? { reciprocalId: e.reciprocalId } : {}),
      } as EscalationItem;
    }).sort(byArrival);
    const max = metadata[ACCUMULATE_MAX];
    return { kind: 'accumulate', count: items.length, max: typeof max === 'number' ? max : null, items, pending: [] };
  }
  const pending = metadata[BATCH_PENDING];
  if (Array.isArray(pending)) {
    const filled = isRecord(envelope?.[BATCH_ITEMS]) ? (envelope![BATCH_ITEMS] as Record<string, unknown>) : {};
    const stamps = isRecord(envelope?.[BATCH_FILLED_AT]) ? (envelope![BATCH_FILLED_AT] as Record<string, unknown>) : {};
    const items = Object.entries(filled).map(([itemKey, payload]) => ({
      itemKey,
      at: typeof stamps[itemKey] === 'string' ? (stamps[itemKey] as string) : '',
      ...(isRecord(payload) ? { payload } : {}),
    } as EscalationItem)).sort(byArrival);
    const keys = metadata[BATCH_KEYS];
    return {
      kind: 'batch',
      count: items.length,
      max: Array.isArray(keys) ? keys.length : null,
      items,
      pending: pending.filter((k): k is string => typeof k === 'string'),
    };
  }
  return null;
}

/** A one-line summary of an item payload for the list row. */
export function summarizePayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const parts = Object.entries(payload).slice(0, 3).map(([k, v]) => {
    const text = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    return `${k}: ${text.length > 24 ? `${text.slice(0, 23)}…` : text}`;
  });
  const more = Object.keys(payload).length - parts.length;
  return more > 0 ? `${parts.join(' · ')} · +${more}` : parts.join(' · ');
}
