/**
 * Review diff of a list: what a reviewer added, removed and edited against what
 * the model proposed. Items compare by position unless the schema keys rows
 * (`x-lt-item-key`) or declares the list unordered (`x-lt-unordered`), in which
 * case a reorder alone is not a change. A closed option list is unordered by default. Scalars compare as every answer does
 * (trimmed, `"42"` equals `42`); `null` ("not stated") and `[]` differ.
 */
import { comparable } from './answer-compare';
import { isObjectItems, itemSchemaOf, readListSpec } from './x-lt-list';
import { X_LT_OPTIONS } from './x-lt-options';

type Schema = Record<string, unknown>;

export interface ItemMark {
  /** The item's position in the current list. */
  index: number;
  kind: 'same' | 'added' | 'edited';
  /** The proposed item it was matched with, when it was. */
  proposed?: unknown;
  /** That proposed item's position in the proposal; scores and the proposal itself are indexed by it. */
  proposedIndex?: number;
  /** The cells (properties) that differ, for an edited row. */
  cells?: string[];
}

export interface RemovedItem {
  item: unknown;
  /** Where it sat among the current items: the index of the item that now follows its place. */
  before: number;
}

export interface ListDiff {
  marks: ItemMark[];
  removed: RemovedItem[];
  added: number;
  edited: number;
  /** added + removed + edited items. */
  itemsChanged: number;
  /** Whether the list differs at all, `null` against `[]` included. */
  changed: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const same = (a: unknown, b: unknown) => comparable(a) === comparable(b);

/** The cells whose values differ between two rows, undeclared properties included. */
export function changedCells(proposed: unknown, current: unknown): string[] {
  const a = isRecord(proposed) ? proposed : {};
  const b = isRecord(current) ? current : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));
}

function compareItem(proposed: unknown, current: unknown, asRows: boolean): { kind: 'same' | 'edited'; cells?: string[] } {
  if (asRows && (isRecord(proposed) || isRecord(current))) {
    const cells = changedCells(proposed, current);
    return cells.length === 0 ? { kind: 'same' } : { kind: 'edited', cells };
  }
  return same(proposed, current) ? { kind: 'same' } : { kind: 'edited' };
}

type Keyer = (item: unknown, index: number) => string | null;

/**
 * A closed option list is a set: its picks come back in option order whatever
 * order the model proposed them in, so it compares unordered unless the
 * schema says `x-lt-unordered: false`.
 */
function isUnordered(spec: ReturnType<typeof readListSpec>, fieldSchema: Schema | null | undefined): boolean {
  if (spec.unordered) return true;
  return fieldSchema?.[X_LT_OPTIONS] !== undefined && fieldSchema?.['x-lt-unordered'] !== false;
}

function keyedMatcher(spec: ReturnType<typeof readListSpec>, asRows: boolean, unordered: boolean): Keyer | null {
  if (spec.itemKey && asRows) return (item) => (isRecord(item) ? comparable(item[spec.itemKey!]) : null);
  if (unordered) return (item) => comparable(item);
  return null;
}

/** Match each current item to an unused proposed item by key; the rest are added and removed. */
function diffByKey(proposed: unknown[], current: unknown[], key: Keyer, asRows: boolean): Pick<ListDiff, 'marks' | 'removed'> {
  const pool = new Map<string, number[]>();
  proposed.forEach((item, i) => {
    const k = key(item, i);
    if (k !== null) pool.set(k, [...(pool.get(k) ?? []), i]);
  });
  const currentOf = new Map<number, number>();
  const marks: ItemMark[] = current.map((item, index) => {
    const k = key(item, index);
    const at = k === null ? undefined : pool.get(k)?.shift();
    if (at === undefined) return { index, kind: 'added' };
    currentOf.set(at, index);
    return { index, proposed: proposed[at], proposedIndex: at, ...compareItem(proposed[at], item, asRows) };
  });
  const removed: RemovedItem[] = [];
  proposed.forEach((item, i) => {
    if (currentOf.has(i)) return;
    let before = 0;
    for (let p = i - 1; p >= 0; p--) {
      const kept = currentOf.get(p);
      if (kept !== undefined) { before = kept + 1; break; }
    }
    removed.push({ item, before });
  });
  return { marks, removed };
}

function diffByPosition(proposed: unknown[], current: unknown[], asRows: boolean): Pick<ListDiff, 'marks' | 'removed'> {
  const marks: ItemMark[] = current.map((item, index) =>
    index < proposed.length ? { index, proposed: proposed[index], proposedIndex: index, ...compareItem(proposed[index], item, asRows) } : { index, kind: 'added' },
  );
  const removed = proposed.slice(current.length).map((item) => ({ item, before: current.length }));
  return { marks, removed };
}

/** The diff of a current list against its proposal under the field's schema. */
export function diffList(proposed: unknown, current: unknown, fieldSchema: Schema | null | undefined): ListDiff {
  const spec = readListSpec(fieldSchema);
  const asRows = isObjectItems(itemSchemaOf(fieldSchema));
  const p = asList(proposed);
  const c = asList(current);
  const key = keyedMatcher(spec, asRows, isUnordered(spec, fieldSchema));
  const { marks, removed } = key ? diffByKey(p, c, key, asRows) : diffByPosition(p, c, asRows);
  const added = marks.filter((m) => m.kind === 'added').length;
  const edited = marks.filter((m) => m.kind === 'edited').length;
  const itemsChanged = added + edited + removed.length;
  const nullness = (proposed == null) !== (current == null) && (Array.isArray(proposed) || Array.isArray(current));
  return { marks, removed, added, edited, itemsChanged, changed: itemsChanged > 0 || nullness };
}
