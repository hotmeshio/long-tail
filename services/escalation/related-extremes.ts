// ---------------------------------------------------------------------------
// min/max over a related set: the least or greatest item payload value, or
// related row metadata value, per host. One statement per (set, value) pair,
// under the same read scope as the set's counts.
// ---------------------------------------------------------------------------

import { getPool } from '../../lib/db';
import { RELATED_AGGREGATES, SPLIT_PATHS, type RelatedExtreme, type RelatedHostAggregate } from '../../shared/list-schema';

import { ensureEscalationCompatView } from './client';
import { itemEntriesCte, querySetFrom, type RelatedQueryInput } from './related';
import type { ReadScopeInput } from './read-scope-sql';

type Aggregates = Record<string, RelatedHostAggregate>;

const NUMBER_TEXT = '^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$';

/**
 * Per host: how many values, whether every one is numeric, and the extreme
 * as a number and as text. `v` is the jsonb value; objects, arrays, nulls and
 * blanks are not values. Text compares in code-unit order, as the dashboard folds.
 */
function extremeSelect(fold: RelatedExtreme, hostId: string, v: string, from: string): string {
  const fn = fold === RELATED_AGGREGATES.MIN ? 'min' : 'max';
  return `SELECT host_id, count(*)::int AS n, bool_and(t ~ '${NUMBER_TEXT}') AS numeric,
       ${fn}(CASE WHEN t ~ '${NUMBER_TEXT}' THEN t::numeric END)::text AS num,
       ${fn}(t COLLATE "C") AS txt
     FROM (SELECT h_id AS host_id, x #>> '{}' AS t
       FROM (SELECT ${hostId}::text AS h_id, ${v} AS x ${from}) raw
       WHERE jsonb_typeof(x) IN ('string', 'number', 'boolean') AND x #>> '{}' <> '') vals
     GROUP BY host_id`;
}

function foldExtremeRows(
  rows: Array<{ host_id: string; n: number; numeric: boolean; num: string | null; txt: string | null }>,
  hostIds: string[],
): Aggregates {
  const out: Aggregates = {};
  for (const id of hostIds) out[id] = { count: 0 };
  for (const row of rows) {
    if (!out[row.host_id]) continue;
    const value = row.numeric && row.num !== null ? Number(row.num) : row.txt;
    out[row.host_id] = value === null ? { count: row.n } : { count: row.n, value };
  }
  return out;
}

/** The least or greatest `payload.<path>` among each host's items. */
export async function extremeRelatedItems(opts: {
  hostIds: string[];
  scope: ReadScopeInput;
  fold: RelatedExtreme;
  path: string;
}): Promise<Aggregates> {
  if (!opts.hostIds.length) return {};
  await ensureEscalationCompatView();
  const params: unknown[] = [];
  const cte = itemEntriesCte(params, opts.scope, opts.hostIds);
  const pi = params.push(opts.path.slice(SPLIT_PATHS.PAYLOAD.length).split('.'));
  const v = `(CASE WHEN en.acc THEN en.entry->'payload' ELSE en.entry END) #> $${pi}::text[]`;
  const { rows } = await getPool().query(`WITH ${cte} ${extremeSelect(opts.fold, 'en.host_id', v, 'FROM entries en')}`, params);
  return foldExtremeRows(rows, opts.hostIds);
}

/** The least or greatest `metadata.<key>` among the rows sharing each host's facets. */
export async function extremeRelatedQuery(
  input: RelatedQueryInput & { fold: RelatedExtreme; path: string },
): Promise<Aggregates> {
  const hostIds = input.hosts.map((h) => h.hostId);
  if (!hostIds.length || !input.roles.length) return foldExtremeRows([], hostIds);
  await ensureEscalationCompatView();
  const params: unknown[] = [];
  const from = querySetFrom(params, input);
  const ki = params.push(input.path.slice(SPLIT_PATHS.METADATA.length));
  const { rows } = await getPool().query(extremeSelect(input.fold, 'h.host_id', `e.metadata->$${ki}`, from), params);
  return foldExtremeRows(rows, hostIds);
}
