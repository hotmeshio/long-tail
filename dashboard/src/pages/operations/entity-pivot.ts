import type { AggregateRow } from '../../api/escalation-analytics';

// Pivot helpers for the entity lens. The RANKING query (grouped by the entity
// facet alone) defines a page: one row per entity, ordered by total tracked
// time — so an entity can never straddle a page boundary and its rank is its
// whole dwell, not its largest state. The state-split and membership queries
// then annotate exactly that page (anyOf-targeted). Pure functions.

export interface EntityRow {
  value: string;
  groups: AggregateRow[];
  total: number;
  nowState: string | null;
}

export function totalDwell(groups: AggregateRow[]): number {
  return groups.reduce((sum, g) => sum + (g.dwellSeconds ?? 0), 0) || 1;
}

/** The page's entity values in rank order (one ranking row per entity). */
export function entityValues(rankGroups: AggregateRow[], entityKey: string): string[] {
  const out: string[] = [];
  for (const g of rankGroups) {
    const value = g.facets[entityKey];
    if (value == null || (g.dwellSeconds ?? 0) <= 0) continue;
    out.push(value);
  }
  return out;
}

/**
 * Assemble per-entity band rows for one page: ranking rows fix membership,
 * order, and totals; state-split rows fill each entity's band; membership
 * rows annotate the current state.
 */
export function pivotEntities(
  rankGroups: AggregateRow[],
  stateGroups: AggregateRow[],
  nowGroups: AggregateRow[],
  entityKey: string,
): EntityRow[] {
  const statesByValue = new Map<string, AggregateRow[]>();
  for (const g of stateGroups) {
    const value = g.facets[entityKey];
    if (value == null || (g.dwellSeconds ?? 0) <= 0) continue;
    const rows = statesByValue.get(value) ?? [];
    rows.push(g);
    statesByValue.set(value, rows);
  }
  const nowByValue = new Map<string, string>();
  for (const g of nowGroups) {
    const value = g.facets[entityKey];
    if (value == null || (g.count ?? 0) <= 0 || g.state == null) continue;
    // Multiple live states for one entity is a model smell; surface the first.
    if (!nowByValue.has(value)) nowByValue.set(value, g.state);
  }
  const rows: EntityRow[] = [];
  for (const g of rankGroups) {
    const value = g.facets[entityKey];
    if (value == null || (g.dwellSeconds ?? 0) <= 0) continue;
    const groups = [...(statesByValue.get(value) ?? [])]
      .sort((a, b) => (b.dwellSeconds ?? 0) - (a.dwellSeconds ?? 0));
    rows.push({
      value,
      groups,
      total: g.dwellSeconds ?? 0,
      nowState: nowByValue.get(value) ?? null,
    });
  }
  return rows;
}
