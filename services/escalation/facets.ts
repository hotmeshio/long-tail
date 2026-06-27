// ---------------------------------------------------------------------------
// Faceted escalation access — a rich search/claim interface over the queue so a
// consuming app can implement routing *strategies* against the data facets
// (metadata, priority, …). The platform supplies the surface; the policy
// (capability, priority, capacity packing, the loop) is the app's (see examples/).
//
// The dispatcher pattern: pull a *page* of complete orders (page size = how many
// printers/consumers are free), then distribute one order per consumer. Reads go
// through the `public.lt_escalations` view; atomic claims run on
// `public.hmsh_escalations` with FOR UPDATE SKIP LOCKED, so many dispatchers run
// without contention. An order is a set of escalations sharing `origin_id`; its
// unit count lives in a metadata facet (default `orderSize`) the app saves, so a
// group is claimed all-or-nothing only when complete.
// ---------------------------------------------------------------------------

import type { PoolClient } from 'pg';

import { getPool } from '../../lib/db';
import { ensureEscalationCompatView } from './client';
import { toEscalationRecords } from './map';
import { buildFacetWhere, buildFacetOrder, buildGroupOrder, ENSURE_ORIGIN_INDEX } from './facet-sql';
import type { ClaimedGroup, FacetQuery, GroupSummary, LTEscalationRecord } from '../../types';

const DEFAULT_LIMIT = 50;
const DEFAULT_CLAIM_MINUTES = 30;
const DEFAULT_SIZE_FACET = 'orderSize';
/** Extra candidates fetched per claim so contention skips still fill the page. */
const CANDIDATE_OVERSCAN = 4;

let ready: Promise<void> | null = null;

/** Ensure the compat view + the origin_id index exist before the first query. */
export function ensureFacetReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureEscalationCompatView(); // hmsh_escalations + lt_escalations view
      await getPool().query(ENSURE_ORIGIN_INDEX);
    })();
  }
  return ready;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Item-level faceted search — filter/sort over top-level columns and metadata facets. */
export async function searchByFacets(
  query: FacetQuery,
): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  await ensureFacetReady();
  const pool = getPool();
  const params: unknown[] = [];
  const where = buildFacetWhere(query, params);
  const order = buildFacetOrder(query.orderBy);
  const limit = query.limit ?? DEFAULT_LIMIT;
  const offset = query.offset ?? 0;

  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT * FROM public.lt_escalations WHERE ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query(`SELECT count(*)::int AS total FROM public.lt_escalations WHERE ${where}`, params),
  ]);
  return { escalations: toEscalationRecords(rows.rows as any), total: count.rows[0]?.total ?? 0 };
}

/**
 * Order-level view of the pond — what a batched dispatcher reads to page by
 * capacity. Each row is an order (origin) with its unit count, availability and
 * completeness, so the app grabs only as many orders as it has free consumers.
 */
export async function searchGroups(
  query: FacetQuery,
  opts: { sizeFacet?: string; limit?: number; offset?: number } = {},
): Promise<GroupSummary[]> {
  await ensureFacetReady();
  const sizeFacet = opts.sizeFacet ?? DEFAULT_SIZE_FACET;
  const params: unknown[] = [sizeFacet]; // $1 = metadata key holding the unit count
  const where = buildFacetWhere(query, params);
  const groupOrder = buildGroupOrder(query.orderBy);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const offset = opts.offset ?? 0;

  const { rows } = await getPool().query(
    `SELECT origin_id,
            count(*)::int                                   AS member_count,
            max((metadata->>$1)::int)                       AS order_size,
            bool_and(assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW()) AS available,
            (max((metadata->>$1)::int) IS NULL OR count(*) >= max((metadata->>$1)::int)) AS complete,
            min(priority)::int                              AS min_priority,
            min(created_at)                                 AS created_at
     FROM public.lt_escalations
     WHERE origin_id IS NOT NULL AND ${where}
     GROUP BY origin_id
     ORDER BY ${groupOrder}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows.map((r: any) => ({
    originId: r.origin_id,
    memberCount: r.member_count,
    orderSize: r.order_size ?? null,
    available: r.available,
    complete: r.complete,
    minPriority: r.min_priority,
    createdAt: r.created_at,
  }));
}

/** Aggregate count — capacity / in-flight soft-limit checks. */
export async function countByFacets(query: FacetQuery): Promise<number> {
  await ensureFacetReady();
  const params: unknown[] = [];
  const where = buildFacetWhere(query, params);
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM public.lt_escalations WHERE ${where}`,
    params,
  );
  return rows[0]?.n ?? 0;
}

// ── Claim ────────────────────────────────────────────────────────────────────

/** Lock + completeness-check + claim one order inside an open transaction. */
async function tryClaimGroup(
  client: PoolClient,
  originId: string,
  consumer: string,
  durationMinutes: number,
  sizeFacet: string,
): Promise<ClaimedGroup | null> {
  const locked = await client.query(
    `SELECT id, (metadata->>$2)::int AS order_size,
            (assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW()) AS avail
     FROM public.hmsh_escalations
     WHERE origin_id = $1 AND status = 'pending'
     FOR UPDATE SKIP LOCKED`,
    [originId, sizeFacet],
  );
  const members = locked.rows;
  const declared = members.reduce((m: number, r: any) => Math.max(m, r.order_size ?? 0), 0);
  const expected = declared > 0 ? declared : members.length;
  const allAvailable = members.length > 0 && members.every((r: any) => r.avail);
  if (members.length !== expected || !allAvailable) return null; // contended / incomplete

  const claimed = await client.query(
    `UPDATE public.hmsh_escalations e
     SET assigned_to = $2, assigned_until = NOW() + make_interval(mins => $3),
         claim_expires_at = NOW() + make_interval(mins => $3),
         claimed_at = COALESCE(e.claimed_at, NOW()), updated_at = NOW()
     WHERE e.origin_id = $1 AND e.status = 'pending' RETURNING e.*`,
    [originId, consumer, durationMinutes],
  );
  return { originId, members: toEscalationRecords(claimed.rows as any) };
}

/**
 * Pull a *page* of complete orders — the dispatcher primitive. Claims up to
 * `limit` eligible orders (each all-or-nothing) in rank order, skipping any a
 * competing dispatcher holds. Page `limit` = how many consumers/printers are
 * free, so a dependent grabs exactly as much as it can distribute. `limit=1`
 * claims a single order.
 */
export async function claimGroups(
  query: FacetQuery,
  consumer: string,
  opts: { limit?: number; durationMinutes?: number; sizeFacet?: string } = {},
): Promise<ClaimedGroup[]> {
  await ensureFacetReady();
  const limit = Math.max(1, opts.limit ?? 1);
  const durationMinutes = opts.durationMinutes ?? DEFAULT_CLAIM_MINUTES;
  const sizeFacet = opts.sizeFacet ?? DEFAULT_SIZE_FACET;
  const pool = getPool();
  const client = await pool.connect();
  try {
    const params: unknown[] = [sizeFacet];
    const where = buildFacetWhere({ ...query, status: query.status ?? 'pending' }, params);
    const groupOrder = buildGroupOrder(query.orderBy);
    const cands = await client.query(
      `SELECT origin_id FROM public.hmsh_escalations
       WHERE origin_id IS NOT NULL AND ${where}
       GROUP BY origin_id
       HAVING bool_and(assigned_to IS NULL OR assigned_until IS NULL OR assigned_until <= NOW())
          AND count(*) = COALESCE(max((metadata->>$1)::int), count(*))
       ORDER BY ${groupOrder}
       LIMIT ${limit * CANDIDATE_OVERSCAN}`,
      params,
    );

    await client.query('BEGIN');
    const claimed: ClaimedGroup[] = [];
    for (const { origin_id: originId } of cands.rows) {
      if (claimed.length >= limit) break;
      const group = await tryClaimGroup(client, originId, consumer, durationMinutes, sizeFacet);
      if (group) claimed.push(group);
    }
    await client.query('COMMIT');
    return claimed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Batch-claim *individual* escalations matching a facet query — the single-row
 * sibling of `claimGroups`. Locks up to `limit` available rows in rank order with
 * `FOR UPDATE SKIP LOCKED`, so concurrent claimers take disjoint sets without
 * contention. With `allOrNone`, the claim commits only when the full `limit` was
 * acquired (otherwise it rolls back and returns `[]`) — the all-or-none lock a
 * dispatcher wants over a counted set it anticipated. Returns the claimed records.
 */
export async function claimByFacets(
  query: FacetQuery,
  consumer: string,
  opts: { limit?: number; durationMinutes?: number; allOrNone?: boolean } = {},
): Promise<LTEscalationRecord[]> {
  await ensureFacetReady();
  const limit = Math.max(1, opts.limit ?? 1);
  const durationMinutes = opts.durationMinutes ?? DEFAULT_CLAIM_MINUTES;
  const pool = getPool();
  const client = await pool.connect();
  try {
    const params: unknown[] = [];
    const where = buildFacetWhere(
      { ...query, available: true, status: query.status ?? 'pending' },
      params,
    );
    const order = buildFacetOrder(query.orderBy);
    const consumerIdx = params.length + 1;
    const durationIdx = params.length + 2;

    // One atomic statement: a FOR UPDATE SKIP LOCKED CTE picks the rank-ordered
    // page, the UPDATE claims exactly those rows. RETURNING count = rows acquired.
    await client.query('BEGIN');
    const claimed = await client.query(
      `WITH locked AS (
         SELECT id FROM public.hmsh_escalations
         WHERE ${where}
         ORDER BY ${order}
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
       )
       UPDATE public.hmsh_escalations e
       SET assigned_to = $${consumerIdx}, assigned_until = NOW() + make_interval(mins => $${durationIdx}),
           claim_expires_at = NOW() + make_interval(mins => $${durationIdx}),
           claimed_at = COALESCE(e.claimed_at, NOW()), updated_at = NOW()
       FROM locked WHERE e.id = locked.id
       RETURNING e.*`,
      [...params, consumer, durationMinutes],
    );

    if (claimed.rows.length === 0 || (opts.allOrNone && claimed.rows.length < limit)) {
      await client.query('ROLLBACK'); // all-or-none unmet, or nothing eligible
      return [];
    }
    await client.query('COMMIT');
    return toEscalationRecords(claimed.rows as any);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
