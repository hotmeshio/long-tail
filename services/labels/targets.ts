// Resolves a print job's source into targets, reading as the caller.

import { getPool } from '../../lib/db';
import { config } from '../../modules/config';
import { SCAN_SCHEME_KINDS, SCAN_TARGET_MATCH, type ScanScheme } from '../../types';
import type { LTApiAuth } from '../../types/sdk';
import type { LabelSource, LabelTarget } from '../../types/labels';
import { LabelRequestError } from './errors';

export const MAX_RANGE_PAD = 12;

function cap(scheme: ScanScheme): number {
  return scheme.kind === SCAN_SCHEME_KINDS.IDENTITY
    ? config.LT_LABELS_MAX_CREDENTIALS_PER_JOB
    : config.LT_LABELS_MAX_PER_JOB;
}

function assertCount(n: number, scheme: ScanScheme): void {
  if (n === 0) throw new LabelRequestError(400, 'the source names no targets');
  if (n > cap(scheme)) throw new LabelRequestError(400, `the source names ${n} targets; one job prints at most ${cap(scheme)}`);
}

/** Targets from pasted lines or CSV. A first row naming `target` is a header; its columns become item tokens. */
export function parseListSource(text: string): LabelTarget[] {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[,\t]/).map((c) => c.trim()));
  if (rows.length === 0) return [];
  const header = rows[0][0].toLowerCase() === 'target' ? rows.shift()!.map((h) => h.replace(/[^a-zA-Z0-9_]/g, '_')) : null;
  return rows.map((cells) => {
    const item: Record<string, string> = {};
    cells.slice(1).forEach((value, i) => { item[header?.[i + 1] || `col${i + 2}`] = value; });
    return { target: cells[0], item };
  });
}

/** Targets from a numeric run: prefix + zero-padded number + suffix. */
export function expandRangeSource(source: Extract<LabelSource, { kind: 'range' }>, max: number): LabelTarget[] {
  const { from, to, pad = 0, prefix = '', suffix = '' } = source;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
    throw new LabelRequestError(400, 'a range needs whole numbers with from ≤ to');
  }
  if (!Number.isInteger(pad) || pad < 0 || pad > MAX_RANGE_PAD) {
    throw new LabelRequestError(400, `pad must be between 0 and ${MAX_RANGE_PAD}`);
  }
  if (to - from + 1 > max) throw new LabelRequestError(400, `the range names ${to - from + 1} targets; one job prints at most ${max}`);
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    target: `${prefix}${String(from + i).padStart(pad, '0')}${suffix}`,
  }));
}

/** Rows read at once for a selection; each read applies the caller's own access check. */
const ESCALATION_READ_CHUNK = 25;

async function escalationTargets(ids: string[], scheme: ScanScheme, auth: LTApiAuth): Promise<LabelTarget[]> {
  const { getEscalation } = await import('../../api/escalations/single');
  const unique = [...new Set(ids)];
  const byTarget = new Map<string, LabelTarget>();
  for (let i = 0; i < unique.length; i += ESCALATION_READ_CHUNK) {
    const chunk = unique.slice(i, i + ESCALATION_READ_CHUNK);
    const results = await Promise.all(chunk.map((id) => getEscalation({ id }, auth)));
    results.forEach((result, j) => {
      if (result.status !== 200) {
        throw new LabelRequestError(result.status === 404 ? 404 : 403, `escalation ${chunk[j]}: ${result.error}`);
      }
      addRow(byTarget, result.data, scheme);
    });
  }
  return [...byTarget.values()];
}

async function facetTargets(source: Extract<LabelSource, { kind: 'facets' }>, scheme: ScanScheme, auth: LTApiAuth): Promise<LabelTarget[]> {
  const { searchByFacets } = await import('../../api/escalations/facets');
  const result = await searchByFacets({ ...source.query, limit: cap(scheme) + 1 }, auth);
  if (result.status !== 200) throw new LabelRequestError(result.status === 400 ? 400 : 403, result.error ?? 'facet search refused');
  const byTarget = new Map<string, LabelTarget>();
  for (const row of result.data.escalations) addRow(byTarget, row, scheme);
  return [...byTarget.values()];
}

/** Keep the newest row per target; a member facet contributes each of its values. */
function addRow(byTarget: Map<string, LabelTarget>, row: any, scheme: ScanScheme): void {
  const value = row.metadata?.[scheme.target_facet];
  const values = Array.isArray(value) && scheme.target_match === SCAN_TARGET_MATCH.MEMBER ? value : [value];
  for (const v of values) {
    if (v === undefined || v === null || v === '') continue;
    const target = String(v);
    const seen = byTarget.get(target);
    if (!seen || String(row.created_at) > String(seen.item?.__created_at ?? '')) {
      byTarget.set(target, { target, item: { ...row.metadata, __created_at: row.created_at }, resolved: true });
    }
  }
}

const USERS_WITH_KEY = `
  SELECT u.id FROM lt_users u
  WHERE u.metadata ? $1
    AND ($2::uuid[] IS NOT NULL OR u.status = 'active')
    AND ($2::uuid[] IS NULL OR u.id = ANY($2::uuid[]))
    AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM lt_user_roles r WHERE r.user_id = u.id AND r.role = $3))
  ORDER BY u.display_name NULLS LAST, u.external_id
  LIMIT $4`;

async function userTargets(source: Extract<LabelSource, { kind: 'users' }>, scheme: ScanScheme): Promise<LabelTarget[]> {
  const { getUser, getIdentityPropertyKeys } = await import('../user');
  const { onlyUuids } = await import('../../lib/uuid');
  const ids = source.userIds ? onlyUuids(source.userIds) : null;
  if (source.userIds && ids!.length !== new Set(source.userIds).size) {
    throw new LabelRequestError(400, 'userIds must be user ids');
  }
  const { rows } = await getPool().query(USERS_WITH_KEY, [scheme.target_facet, ids, source.role ?? null, cap(scheme) + 1]);
  const identityKeys = await getIdentityPropertyKeys();
  const users = await Promise.all(rows.map((r: { id: string }) => getUser(r.id)));
  return users.filter((u) => u !== null).map((u) => {
    const metadata = { ...(u!.metadata ?? {}) };
    for (const key of identityKeys) delete metadata[key];
    return {
      target: String(u!.metadata![scheme.target_facet]),
      userId: u!.id,
      resolved: u!.status === 'active',
      user: {
        ...metadata,
        name: u!.display_name ?? u!.external_id,
        display_name: u!.display_name,
        email: u!.email,
        roles: u!.roles.map((r) => r.role),
      },
    };
  });
}

/**
 * The targets a source names. Identity schemes read users only: a pasted or
 * ranged credential would mint a badge for no one. Rows are read as the
 * caller, so a job never prints what the caller cannot see.
 */
export async function resolveLabelTargets(source: LabelSource, scheme: ScanScheme, auth: LTApiAuth): Promise<LabelTarget[]> {
  const identity = scheme.kind === SCAN_SCHEME_KINDS.IDENTITY;
  if (identity && source.kind !== 'users') {
    throw new LabelRequestError(400, 'identity labels print for users; use a users source');
  }
  if (!identity && source.kind === 'users') {
    throw new LabelRequestError(400, 'a users source prints identity labels only');
  }
  let targets: LabelTarget[];
  switch (source.kind) {
    case 'escalations':
      if (!Array.isArray(source.ids)) throw new LabelRequestError(400, 'ids must be a list');
      assertCount(new Set(source.ids).size, scheme);
      targets = await escalationTargets(source.ids, scheme, auth);
      break;
    case 'facets':
      targets = await facetTargets(source, scheme, auth);
      break;
    case 'users':
      targets = await userTargets(source, scheme);
      break;
    case 'list':
      targets = parseListSource(String(source.text ?? ''));
      break;
    case 'range':
      targets = expandRangeSource(source, cap(scheme));
      break;
    default:
      throw new LabelRequestError(400, `unknown source kind "${(source as { kind: string }).kind}"`);
  }
  for (const t of targets) delete t.item?.__created_at;
  assertCount(targets.length, scheme);
  return targets;
}

/** Marks which action targets name a row today, in one statement. */
export async function markResolvedTargets(targets: LabelTarget[], scheme: ScanScheme): Promise<void> {
  const unchecked = targets.filter((t) => t.resolved === undefined);
  if (unchecked.length === 0) return;
  const member = scheme.target_match === SCAN_TARGET_MATCH.MEMBER;
  const { rows } = await getPool().query(
    `SELECT t FROM unnest($2::text[]) AS t
     WHERE EXISTS (SELECT 1 FROM lt_escalations e WHERE e.metadata @> ${member ? 'jsonb_build_object($1::text, jsonb_build_array(t))' : 'jsonb_build_object($1::text, t)'})`,
    [scheme.target_facet, unchecked.map((t) => t.target)],
  );
  const found = new Set(rows.map((r: { t: string }) => r.t));
  for (const t of unchecked) t.resolved = found.has(t.target);
}
