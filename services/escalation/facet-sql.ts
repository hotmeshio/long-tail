// ---------------------------------------------------------------------------
// Faceted routing SQL — composable, injection-safe predicate + ORDER BY builders
// over the escalation queue. Reads go through the `public.lt_escalations` view
// (adds the computed `available` flag); atomic claims run on the shared
// `public.hmsh_escalations` table, the same raw-SQL-on-the-shared-table pattern
// as services/escalation/sql.ts. Metadata facets use the GIN index (`@>`).
// ---------------------------------------------------------------------------

import type { FacetOrder, FacetQuery, FacetRange } from '../../types';

// Top-level columns a caller may sort/range on directly. Anything else must be a
// `metadata.<key>` facet. Keeps interpolation to a fixed, audited set.
const ORDER_COLUMNS = new Set(['priority', 'created_at', 'updated_at', 'status', 'role']);
const RANGE_OPS = new Set(['<', '<=', '>', '>=', '=']);
// Metadata keys are interpolated (as a JSON path), so they are strictly validated.
const FACET_KEY = /^[a-zA-Z0-9_]+$/;

/** A metadata extraction expression for a validated key (text or numeric). */
function metaExpr(key: string, numeric = false): string {
  return numeric ? `(metadata->>'${key}')::numeric` : `(metadata->>'${key}')`;
}

/**
 * Build the WHERE clause for a faceted query, pushing bound params into `params`.
 * Every value is parameterized; only validated column names / metadata keys and
 * a fixed operator set are interpolated. Returns `TRUE` when empty.
 */
export function buildFacetWhere(q: FacetQuery, params: unknown[]): string {
  const clauses: string[] = [];

  if (q.role) {
    params.push(q.role);
    clauses.push(`role = $${params.length}`);
  } else if (q.roles && q.roles.length) {
    params.push(q.roles);
    clauses.push(`role = ANY($${params.length}::text[])`);
  }

  if (q.status) {
    params.push(q.status);
    clauses.push(`status = $${params.length}`);
  }

  if (q.facets && Object.keys(q.facets).length) {
    params.push(JSON.stringify(q.facets));
    clauses.push(`metadata @> $${params.length}::jsonb`); // GIN-served
  }

  if (q.block && q.block.length) {
    params.push(q.block.map((b) => JSON.stringify(b)));
    clauses.push(`NOT (metadata @> ANY($${params.length}::jsonb[]))`);
  }

  for (const r of q.range ?? []) {
    if (!FACET_KEY.test(r.facet) || !RANGE_OPS.has(r.op)) continue;
    params.push(r.value);
    clauses.push(`${metaExpr(r.facet, true)} ${r.op} $${params.length}`);
  }

  for (const key of q.exists ?? []) {
    if (!FACET_KEY.test(key)) continue;
    clauses.push(`metadata ? '${key}'`);
  }

  if (q.available === true) {
    clauses.push(`(assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW())`);
  } else if (q.available === false) {
    clauses.push(`(assigned_to IS NOT NULL AND assigned_until > NOW())`);
  }

  return clauses.length ? clauses.join('\n  AND ') : 'TRUE';
}

const DEFAULT_ORDER = 'priority ASC, created_at ASC';

/** Build an injection-safe ORDER BY mixing top-level columns and metadata facets. */
export function buildFacetOrder(orderBy?: FacetOrder[]): string {
  if (!orderBy || !orderBy.length) return DEFAULT_ORDER;
  const parts: string[] = [];
  for (const o of orderBy) {
    const dir = o.direction === 'desc' ? 'DESC' : 'ASC';
    if (ORDER_COLUMNS.has(o.field)) {
      parts.push(`${o.field} ${dir}`);
    } else if (o.field.startsWith('metadata.')) {
      const key = o.field.slice('metadata.'.length);
      if (!FACET_KEY.test(key)) continue;
      parts.push(`${metaExpr(key, o.numeric)} ${dir} NULLS LAST`);
    }
  }
  return parts.length ? parts.join(', ') : DEFAULT_ORDER;
}

/**
 * Group rank for the all-or-nothing claim: each sort key aggregated across the
 * group's members — `min` for ascending, `max` for descending — so a faceted
 * order over members yields a stable order over orders. Defaults to the natural
 * priority/FIFO order.
 */
export function buildGroupOrder(orderBy?: FacetOrder[]): string {
  if (!orderBy || !orderBy.length) return 'min(priority) ASC, min(created_at) ASC';
  const parts: string[] = [];
  for (const o of orderBy) {
    const desc = o.direction === 'desc';
    const agg = desc ? 'max' : 'min';
    const dir = desc ? 'DESC' : 'ASC';
    if (ORDER_COLUMNS.has(o.field)) {
      parts.push(`${agg}(${o.field}) ${dir}`);
    } else if (o.field.startsWith('metadata.')) {
      const key = o.field.slice('metadata.'.length);
      if (!FACET_KEY.test(key)) continue;
      parts.push(`${agg}(${metaExpr(key, o.numeric)}) ${dir} NULLS LAST`);
    }
  }
  return parts.length ? parts.join(', ') : 'min(priority) ASC, min(created_at) ASC';
}

/** Lazily-ensured index for the group aggregation (origin_id over the pending pool). */
export const ENSURE_ORIGIN_INDEX =
  `CREATE INDEX IF NOT EXISTS idx_hmsh_escalations_origin_pending
     ON public.hmsh_escalations (origin_id) WHERE status = 'pending'`;
