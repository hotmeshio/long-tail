// ---------------------------------------------------------------------------
// Related sets for list views: a host row's items (each read through its
// payload or its reciprocal row) and rows in other roles that share facets
// with it. Every statement serves a whole page of hosts and composes the
// caller's read scope, so the cost is bounded by the declaration, never by
// the page size or the item count.
// ---------------------------------------------------------------------------

import { getPool } from '../../lib/db';
import { UUID_RE } from '../../lib/uuid';
import { ESCALATION_ACCUMULATE_KEYS, ESCALATION_BATCH_KEYS } from '../../types/escalation';
import { SPLIT_PATHS, type RelatedHostAggregate, type RelatedRow } from '../../shared/list-schema';

import { ensureEscalationCompatView } from './client';
import { toEscalationRecord } from './map';
import { buildReadScopeClause, type ReadScopeInput } from './read-scope-sql';

const UUID_PATTERN = UUID_RE.source;

/** One host's resolved facet match for a query set. */
export interface RelatedQueryHost {
  hostId: string;
  match: Record<string, unknown>;
}

export interface RelatedQueryInput {
  hosts: RelatedQueryHost[];
  roles: string[];
  status: string;
  scope: ReadScopeInput;
}

type Aggregates = Record<string, RelatedHostAggregate>;

function foldAggregateRows(
  rows: Array<{ host_id: string; split: string | null; hidden?: boolean; n: number }>,
  hostIds: string[],
  split: boolean,
): Aggregates {
  const out: Aggregates = {};
  for (const id of hostIds) out[id] = split ? { count: 0, splits: {} } : { count: 0 };
  for (const row of rows) {
    const agg = out[row.host_id];
    if (!agg) continue;
    agg.count += row.n;
    if (row.hidden) {
      agg.hidden = (agg.hidden ?? 0) + row.n;
    } else if (split) {
      const key = row.split ?? '';
      agg.splits![key] = (agg.splits![key] ?? 0) + row.n;
    }
  }
  return out;
}

/** The hosts and their item entries, read under the caller's scope. */
function itemEntriesCte(params: unknown[], scope: ReadScopeInput, hostIds: string[]): string {
  const hi = params.push(hostIds);
  const hostScope = buildReadScopeClause(scope, params, 'h');
  return `hosts AS (
      SELECT h.id, h.envelope,
        (h.envelope ? '${ESCALATION_ACCUMULATE_KEYS.ITEMS}') AS acc,
        COALESCE(h.envelope->'${ESCALATION_ACCUMULATE_KEYS.ITEMS}', h.envelope->'${ESCALATION_BATCH_KEYS.ITEMS}') AS items
      FROM public.lt_escalations h
      WHERE h.id = ANY($${hi}::uuid[])${hostScope ? ` AND ${hostScope}` : ''}
    ), entries AS (
      SELECT hosts.id AS host_id, hosts.acc, hosts.envelope, e.key AS item_key, e.value AS entry,
        CASE WHEN hosts.acc AND (e.value->>'reciprocalId') ~* '${UUID_PATTERN}'
          THEN (e.value->>'reciprocalId')::uuid END AS rid
      FROM hosts, jsonb_each(CASE WHEN jsonb_typeof(hosts.items) = 'object' THEN hosts.items ELSE '{}'::jsonb END) e
    )`;
}

/**
 * Count each host's items, optionally split by `payload.<path>` or
 * `reciprocal.metadata.<key>`. A reciprocal split counts only reciprocal rows
 * the caller can read; the rest are reported as `hidden`. `roles` names the
 * roles of the readable reciprocal rows, so a list can follow their changes.
 */
export async function aggregateRelatedItems(opts: {
  hostIds: string[];
  scope: ReadScopeInput;
  splitBy?: string;
}): Promise<{ aggregates: Aggregates; roles: string[] }> {
  if (!opts.hostIds.length) return { aggregates: {}, roles: [] };
  await ensureEscalationCompatView();
  const params: unknown[] = [];
  const cte = itemEntriesCte(params, opts.scope, opts.hostIds);
  const splitBy = opts.splitBy ?? '';
  let splitExpr = 'NULL::text';
  let join = '';
  let hiddenExpr = 'false';
  let rolesExpr = 'NULL::text[]';
  if (splitBy.startsWith(SPLIT_PATHS.PAYLOAD)) {
    const pi = params.push(splitBy.slice(SPLIT_PATHS.PAYLOAD.length).split('.'));
    splitExpr = `(CASE WHEN en.acc THEN en.entry->'payload' ELSE en.entry END) #>> $${pi}::text[]`;
  } else if (splitBy.startsWith(SPLIT_PATHS.RECIPROCAL_METADATA)) {
    const ki = params.push(splitBy.slice(SPLIT_PATHS.RECIPROCAL_METADATA.length));
    const rScope = buildReadScopeClause(opts.scope, params, 'r');
    join = `LEFT JOIN public.lt_escalations r ON r.id = en.rid${rScope ? ` AND ${rScope}` : ''}`;
    splitExpr = `r.metadata->>$${ki}`;
    hiddenExpr = '(en.rid IS NOT NULL AND r.id IS NULL)';
    rolesExpr = 'array_agg(DISTINCT r.role) FILTER (WHERE r.id IS NOT NULL)';
  }
  const { rows } = await getPool().query(
    `WITH ${cte}
     SELECT en.host_id::text AS host_id, ${splitExpr} AS split, ${hiddenExpr} AS hidden, count(*)::int AS n,
       ${rolesExpr} AS roles
     FROM entries en ${join}
     GROUP BY 1, 2, 3`,
    params,
  );
  const roles = new Set<string>(rows.flatMap((row) => row.roles ?? []));
  return { aggregates: foldAggregateRows(rows, opts.hostIds, !!splitBy), roles: [...roles].sort() };
}

/** One host's items in fill order, each with its reciprocal row when readable. */
export async function listRelatedItems(opts: {
  hostId: string;
  scope: ReadScopeInput;
  limit: number;
}): Promise<{ rows: RelatedRow[]; total: number }> {
  await ensureEscalationCompatView();
  const params: unknown[] = [];
  const cte = itemEntriesCte(params, opts.scope, [opts.hostId]);
  const rScope = buildReadScopeClause(opts.scope, params, 'r');
  const li = params.push(opts.limit);
  const { rows } = await getPool().query(
    `WITH ${cte}
     SELECT en.item_key, en.entry, en.acc,
       en.envelope->'${ESCALATION_BATCH_KEYS.FILLED_AT}'->>en.item_key AS batch_at,
       en.envelope->'${ESCALATION_BATCH_KEYS.FILLED_BY}'->>en.item_key AS batch_actor,
       (en.rid IS NOT NULL AND r.id IS NULL) AS hidden,
       CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END AS reciprocal,
       count(*) OVER ()::int AS total
     FROM entries en
     LEFT JOIN public.lt_escalations r ON r.id = en.rid${rScope ? ` AND ${rScope}` : ''}
     ORDER BY COALESCE(CASE WHEN en.acc THEN en.entry->>'at' END,
                       en.envelope->'${ESCALATION_BATCH_KEYS.FILLED_AT}'->>en.item_key) NULLS LAST, en.item_key
     LIMIT $${li}`,
    params,
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((row: any) => {
      const entry = row.entry ?? {};
      const item = row.acc
        ? {
            itemKey: row.item_key,
            payload: entry.payload,
            at: entry.at,
            ...(entry.actor ? { actor: entry.actor } : {}),
            ...(entry.reciprocalId ? { reciprocalId: entry.reciprocalId } : {}),
          }
        : {
            itemKey: row.item_key,
            payload: entry,
            ...(row.batch_at ? { at: row.batch_at } : {}),
            ...(row.batch_actor ? { actor: row.batch_actor } : {}),
          };
      return { item, escalation: row.reciprocal ? toEscalationRecord(row.reciprocal) as any : null };
    }),
  };
}

/** The shared FROM/WHERE of a query set: hosts unnested beside their matches. */
function querySetFrom(params: unknown[], input: RelatedQueryInput): string {
  const hi = params.push(input.hosts.map((h) => h.hostId));
  const mi = params.push(input.hosts.map((h) => JSON.stringify(h.match)));
  const ri = params.push(input.roles);
  const si = params.push(input.status);
  const scope = buildReadScopeClause(input.scope, params, 'e');
  return `FROM unnest($${hi}::text[], $${mi}::jsonb[]) AS h(host_id, match)
     JOIN public.lt_escalations e ON e.metadata @> h.match
     WHERE e.role = ANY($${ri}::text[]) AND e.status = $${si}
       AND e.id::text <> h.host_id${scope ? ` AND ${scope}` : ''}`;
}

/**
 * Count the rows that share each host's facets, grouped by role and an
 * optional `metadata.<key>` split. The GIN index serves each host's match.
 */
export async function aggregateRelatedQuery(
  input: RelatedQueryInput & { splitBy?: string },
): Promise<Aggregates> {
  const hostIds = input.hosts.map((h) => h.hostId);
  if (!hostIds.length || !input.roles.length) return foldAggregateRows([], hostIds, !!input.splitBy);
  await ensureEscalationCompatView();
  const params: unknown[] = [];
  const from = querySetFrom(params, input);
  let splitExpr = 'NULL::text';
  if (input.splitBy === SPLIT_PATHS.ROLE) {
    splitExpr = 'e.role';
  } else if (input.splitBy?.startsWith(SPLIT_PATHS.METADATA)) {
    splitExpr = `e.metadata->>$${params.push(input.splitBy.slice(SPLIT_PATHS.METADATA.length))}`;
  }
  const { rows } = await getPool().query(
    `SELECT h.host_id, ${splitExpr} AS split, count(*)::int AS n ${from} GROUP BY 1, 2`,
    params,
  );
  return foldAggregateRows(rows, hostIds, !!input.splitBy);
}

/** One host's related rows, in role order then age. */
export async function listRelatedQueryRows(
  input: RelatedQueryInput & { limit: number },
): Promise<{ rows: RelatedRow[]; total: number }> {
  if (!input.hosts.length || !input.roles.length) return { rows: [], total: 0 };
  await ensureEscalationCompatView();
  const params: unknown[] = [];
  const from = querySetFrom(params, input);
  const oi = params.push(input.roles);
  const li = params.push(input.limit);
  const { rows } = await getPool().query(
    `SELECT to_jsonb(e) AS row, count(*) OVER ()::int AS total ${from}
     ORDER BY array_position($${oi}::text[], e.role), e.created_at
     LIMIT $${li}`,
    params,
  );
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((r: any) => ({ escalation: toEscalationRecord(r.row) as any })),
  };
}

/** Host rows of one role, read under the caller's scope. */
export async function readRelatedHosts(opts: {
  ids: string[];
  role: string;
  scope: ReadScopeInput;
}): Promise<Record<string, unknown>[]> {
  if (!opts.ids.length) return [];
  await ensureEscalationCompatView();
  const params: unknown[] = [opts.ids, opts.role];
  const scope = buildReadScopeClause(opts.scope, params);
  const { rows } = await getPool().query(
    `SELECT * FROM public.lt_escalations WHERE id = ANY($1::uuid[]) AND role = $2${scope ? ` AND ${scope}` : ''}`,
    params,
  );
  return rows.map((row: any) => toEscalationRecord(row) as unknown as Record<string, unknown>);
}
