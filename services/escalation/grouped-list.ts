import { getPool } from '../../lib/db';
import type { LTEscalationRecord } from '../../types';

import { ensureEscalationCompatView } from './client';
import { buildFacetOrder, buildGroupOrder, FACET_KEY } from './facet-sql';
import { toEscalationRecords } from './map';
import { buildScopedSearchWhere, type ScopedFacetSearch } from './queries';

/** One page group: the shared facet value (null for a row without it) and its rows. */
export interface EscalationGroup {
  key: string | null;
  ids: string[];
}

const SINGLETON_PREFIX = 'id:';

/**
 * Scoped faceted search paged by groups of a metadata facet. A page holds
 * whole groups, so a group never splits across pages; a row without the
 * facet is a group of one. `total` counts groups.
 */
export async function searchEscalationsGrouped(
  opts: ScopedFacetSearch & { groupKey: string },
): Promise<{ escalations: LTEscalationRecord[]; total: number; groups: EscalationGroup[] }> {
  if (!FACET_KEY.test(opts.groupKey)) throw new Error(`groupBy must be a metadata key, got "${opts.groupKey}"`);
  await ensureEscalationCompatView();
  const pool = getPool();
  const groupExpr = `COALESCE(metadata->>'${opts.groupKey}', '${SINGLETON_PREFIX}' || id::text)`;

  const params: unknown[] = [];
  const where = buildScopedSearchWhere(opts, params);
  const countParams = [...params];
  const li = params.push(opts.limit);
  const oi = params.push(opts.offset);
  const [page, count] = await Promise.all([
    pool.query(
      `SELECT ${groupExpr} AS g, bool_or(metadata->>'${opts.groupKey}' IS NOT NULL) AS keyed
       FROM public.lt_escalations ${where}
       GROUP BY 1 ORDER BY ${buildGroupOrder(opts.facet.orderBy)}, 1
       LIMIT $${li} OFFSET $${oi}`,
      params,
    ),
    pool.query(
      `SELECT count(DISTINCT ${groupExpr})::int AS total FROM public.lt_escalations ${where}`,
      countParams,
    ),
  ]);
  const keys: string[] = page.rows.map((r: any) => r.g);
  const keyed = new Set<string>(page.rows.filter((r: any) => r.keyed).map((r: any) => r.g));
  const total = count.rows[0]?.total ?? 0;
  if (!keys.length) return { escalations: [], total, groups: [] };

  const memberParams: unknown[] = [];
  const memberWhere = buildScopedSearchWhere(opts, memberParams);
  const ki = memberParams.push(keys);
  const keyClause = `${groupExpr} = ANY($${ki}::text[])`;
  const members = await pool.query(
    `SELECT *, ${groupExpr} AS lt_group FROM public.lt_escalations
     ${memberWhere ? `${memberWhere} AND ${keyClause}` : `WHERE ${keyClause}`}
     ORDER BY ${buildFacetOrder(opts.facet.orderBy)}`,
    memberParams,
  );

  const byKey = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const row of members.rows as any[]) byKey.get(row.lt_group)?.push(row.id);
  const groups = keys.map((k) => ({
    key: keyed.has(k) ? k : null,
    ids: byKey.get(k) ?? [],
  }));
  const escalations = toEscalationRecords(members.rows.map(({ lt_group: _g, ...rest }: any) => rest));
  return { escalations, total, groups };
}
