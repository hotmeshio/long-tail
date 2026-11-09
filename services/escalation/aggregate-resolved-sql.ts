// ---------------------------------------------------------------------------
// The resolved measure: rows resolved within a half-open window, counted per
// group and optionally per UTC calendar bucket. `status = 'resolved'` inlines
// as a literal and the role scope is required, so the planner reads the
// role-led idx_hmsh_esc_resolved_cover range (role, resolved_at) instead of
// sweeping every queue's history. Cost grows with the rows resolved in the
// window for the scoped roles.
// ---------------------------------------------------------------------------

import { config } from '../../modules/config';
import { AnalyticsInputError, resolveWindow } from './aggregate-validate';
import { RESOLVED_BUCKETS } from '../../types';
import type { AnalyticsWindow, ResolvedBucket } from '../../types';

/** The bucket, validated against the closed set; it inlines into date_trunc. */
export function resolveBucket(bucket: unknown): ResolvedBucket | null {
  if (bucket === undefined) return null;
  if (!(RESOLVED_BUCKETS as readonly unknown[]).includes(bucket)) {
    throw new AnalyticsInputError(`measure.bucket "${String(bucket)}" is not one of ${RESOLVED_BUCKETS.join(', ')}`);
  }
  return bucket as ResolvedBucket;
}

export function buildResolvedAggregate(input: {
  window: AnalyticsWindow;
  bucket: ResolvedBucket | null;
  where: string;
  params: unknown[];
  groupSelect: string[];
  groupKeys: string[];
  order: string;
  distinctBy?: string;
  pageLimit: number;
  offset: number;
}): { sql: string; params: unknown[]; nowAnchored: boolean } {
  const win = resolveWindow(input.window, 'measure.window', {
    days: config.LT_ANALYTICS_MAX_RESOLVED_WINDOW_DAYS,
    envVar: 'LT_ANALYTICS_MAX_RESOLVED_WINDOW_DAYS',
  });
  if (!win) throw new AnalyticsInputError('measure.window is required for resolved');

  const { params } = input;
  params.push(win.from.toISOString());
  const fromP = `$${params.length}::timestamptz`;
  params.push(win.to.toISOString());
  const toP = `$${params.length}::timestamptz`;

  const select = [...input.groupSelect];
  const keys = [...input.groupKeys];
  if (input.bucket) {
    select.unshift(`(date_trunc('${input.bucket}', resolved_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket`);
    keys.unshift('bucket');
  }
  const countExpr = input.distinctBy
    ? `count(DISTINCT (metadata->>'${input.distinctBy}'))::int`
    : 'count(*)::int';
  const groupBySql = keys.length ? `GROUP BY ${keys.join(', ')}\n` : '';

  params.push(input.pageLimit + 1, input.offset);
  const sql = `SELECT ${[...select, `${countExpr} AS "count"`, 'count(*)::int AS sample_count'].join(',\n       ')}
FROM public.lt_escalations
WHERE ${input.where}
  AND status = 'resolved'
  AND resolved_at >= ${fromP}
  AND resolved_at < ${toP}
${groupBySql}ORDER BY ${input.order}
LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return { sql, params, nowAnchored: win.nowAnchored };
}
