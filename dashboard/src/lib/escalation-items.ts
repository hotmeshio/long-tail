import type { LTEscalationRecord } from '../api/types';
import { interpolateHelp, type HelpTokenContext } from './x-lt-help';
import { getDeep } from './x-lt-bind';

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

/** The container role's form-schema key naming how each held item displays. */
export const ITEM_LABEL_KEY = 'x-lt-item-label';

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const ITEM_DOMAIN = 'item';
const MISSING = '—';

function formatValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** One token's value: `item.*` from the held item, every other domain as help tokens resolve it. */
function tokenValue(path: string, item: EscalationItem, ctx: HelpTokenContext): string | null {
  const dot = path.indexOf('.');
  const domain = dot === -1 ? path : path.slice(0, dot);
  if (domain === ITEM_DOMAIN) {
    try {
      return formatValue(dot === -1 ? item : getDeep(item, path.slice(dot + 1)));
    } catch {
      return null;
    }
  }
  const value = interpolateHelp(`{{${path}}}`, ctx);
  return value === MISSING ? null : value;
}

/**
 * An item's display label from the role's `x-lt-item-label` template, whose
 * `{{item.*}}` tokens read the held item (itemKey, payload, actor, at) beside
 * the usual escalation domains. Null when there is no template or every token
 * it names is missing, so the caller falls back to the item key.
 */
export function itemLabel(
  template: unknown,
  item: EscalationItem,
  ctx: HelpTokenContext = {},
): string | null {
  if (typeof template !== 'string' || !template.trim()) return null;
  let resolved = 0;
  let tokens = 0;
  const label = template.replace(TOKEN, (_match, rawPath: string) => {
    tokens += 1;
    const value = tokenValue(rawPath, item, ctx);
    if (value === null) return MISSING;
    resolved += 1;
    return value;
  }).trim();
  if (tokens > 0 && resolved === 0) return null;
  return label || null;
}
