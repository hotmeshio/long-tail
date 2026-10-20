import { interpolateHelp } from '../../../lib/x-lt-help';
import { GROUP_FOLDS, foldExtreme, isExtremeAggregate, type GroupFold, type RelatedAggregate, type RelatedHostAggregate } from '../../../lib/list-schema';
import { EM_DASH } from '../../common/display/FormattedValue';
import { rowContext, type ColumnDef } from './row-parts';
import type { LTEscalationRecord } from '../../../api/types';

/** One page group from the grouped list read. */
export interface EscalationGroup {
  key: string | null;
  ids: string[];
}

/** A facet-table row: one escalation, or a group of rows sharing a facet. */
export interface TableRow {
  key: string;
  rows: LTEscalationRecord[];
  /** The shared facet value; null for an ungrouped row or a row without the facet. */
  groupKey: string | null;
  /** 0 for a top-level line; 1 for a member shown under its open group. */
  depth?: number;
  /** A member that closes its group's block. */
  lastChild?: boolean;
  /** A member's group line. */
  parent?: TableRow;
}

/** The lines the table draws: each open group followed by its members. */
export function withOpenMembers(rows: TableRow[], open: ReadonlySet<string>): TableRow[] {
  return rows.flatMap((row) => {
    if (row.rows.length < 2 || !open.has(row.key)) return [row];
    const members = row.rows.map((m, i): TableRow => ({
      key: `${row.key}/${m.id}`,
      rows: [m],
      groupKey: row.groupKey,
      depth: 1,
      lastChild: i === row.rows.length - 1,
      parent: row,
    }));
    return [row, ...members];
  });
}

/** Table rows in page order: one per group when grouped, else one per row. */
export function buildTableRows(rows: LTEscalationRecord[], groups?: EscalationGroup[] | null): TableRow[] {
  if (!groups) return rows.map((r) => ({ key: r.id, rows: [r], groupKey: null }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return groups
    .map((g) => ({
      key: g.key != null ? `group:${g.key}` : g.ids[0],
      rows: g.ids.map((id) => byId.get(id)).filter((r): r is LTEscalationRecord => !!r),
      groupKey: g.key,
    }))
    .filter((g) => g.rows.length > 0);
}

function numeric(values: string[]): number[] | null {
  const nums = values.map((v) => Number(v));
  return nums.every((n) => Number.isFinite(n)) ? nums : null;
}

/**
 * A plain column's text across a group's rows. `first` reads the lead row;
 * `min`/`max` compare numerically when every value is a number, else as text
 * (ISO instants order as text); `sum` adds numbers; `count` counts rows.
 */
export function foldColumnText(col: ColumnDef & { group?: GroupFold }, rows: LTEscalationRecord[]): string {
  const fold = col.group ?? GROUP_FOLDS.FIRST;
  if (fold === GROUP_FOLDS.COUNT) return String(rows.length);
  const values = rows.map((r) => interpolateHelp(col.value, rowContext(r))).filter((v) => v && v !== EM_DASH);
  if (fold === GROUP_FOLDS.DISTINCT) return values.length ? [...new Set(values)].join(', ') : EM_DASH;
  if (fold === GROUP_FOLDS.FIRST || rows.length === 1) return values[0] ?? EM_DASH;
  if (!values.length) return EM_DASH;
  const nums = numeric(values);
  if (fold === GROUP_FOLDS.SUM) return nums ? String(nums.reduce((a, b) => a + b, 0)) : EM_DASH;
  if (nums) return String(fold === GROUP_FOLDS.MIN ? Math.min(...nums) : Math.max(...nums));
  const sorted = [...values].sort();
  return fold === GROUP_FOLDS.MIN ? sorted[0] : sorted[sorted.length - 1];
}

/** One aggregate across several host rows: counts and splits sum; a min or max folds its values. */
export function mergeAggregates(
  aggs: Array<RelatedHostAggregate | undefined>,
  aggregate?: RelatedAggregate,
): RelatedHostAggregate | undefined {
  const present = aggs.filter((a): a is RelatedHostAggregate => !!a);
  if (!present.length) return undefined;
  if (present.every((a) => a.unresolved)) return { count: 0, unresolved: true };
  const out: RelatedHostAggregate = { count: 0 };
  for (const a of present) {
    if (a.unresolved) continue;
    out.count += a.count;
    if (a.hidden) out.hidden = (out.hidden ?? 0) + a.hidden;
    if (a.splits) {
      out.splits ??= {};
      for (const [k, n] of Object.entries(a.splits)) out.splits[k] = (out.splits[k] ?? 0) + n;
    }
  }
  if (isExtremeAggregate(aggregate)) {
    const value = foldExtreme(aggregate, present.flatMap((a) => (a.value === undefined ? [] : [a.value])));
    if (value !== undefined) out.value = value;
  }
  return out;
}
