/**
 * Lookup snapshot cache — keeps escalation lookup resolution off the SQL hot
 * path. A lookup ref pins {domain, key, version}; the snapshot behind it is
 * immutable by design, so entries cache indefinitely under an LRU bound.
 * Thousands of escalations sharing the same refs resolve from memory after
 * the first read. Missing snapshots are never cached — a later seed or
 * republish must become visible.
 */
import { getPool } from '../../lib/db';
import type { EscalationLookupRef } from '../../types/escalation';
import { GET_KNOWLEDGE_VERSION } from './sql';

const SNAPSHOT_CACHE_MAX_ENTRIES = 256;

interface KnowledgeSnapshot {
  data: Record<string, unknown>;
  tags: string[];
}

export interface ResolvedLookup {
  domain: string;
  key: string;
  version: number;
  as?: string;
  data: Record<string, unknown> | null;
  missing?: boolean;
}

// Map preserves insertion order — delete+set on read keeps it LRU.
const snapshotCache = new Map<string, KnowledgeSnapshot>();

/** The immutable snapshot at (domain, key, version), or null when absent. */
export async function getKnowledgeSnapshot(
  domain: string,
  key: string,
  version: number,
): Promise<KnowledgeSnapshot | null> {
  const cacheKey = `${domain} ${key} ${version}`;
  const hit = snapshotCache.get(cacheKey);
  if (hit) {
    snapshotCache.delete(cacheKey);
    snapshotCache.set(cacheKey, hit);
    return hit;
  }
  const pool = getPool();
  const { rows } = await pool.query(GET_KNOWLEDGE_VERSION, [domain, key, version]);
  if (!rows[0]) return null;
  const snapshot: KnowledgeSnapshot = {
    data: (rows[0].data as Record<string, unknown>) ?? {},
    tags: (rows[0].tags as string[]) ?? [],
  };
  snapshotCache.set(cacheKey, snapshot);
  while (snapshotCache.size > SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = snapshotCache.keys().next().value as string;
    snapshotCache.delete(oldest);
  }
  return snapshot;
}

/** Structural check for one ref — malformed entries in stored metadata are skipped, not fatal. */
function isLookupRef(ref: unknown): ref is EscalationLookupRef {
  if (!ref || typeof ref !== 'object') return false;
  const r = ref as Record<string, unknown>;
  return typeof r.domain === 'string' && r.domain.length > 0
    && typeof r.key === 'string' && r.key.length > 0
    && typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 1
    && (r.as === undefined || (typeof r.as === 'string' && r.as.length > 0));
}

/**
 * Resolve a metadata `lookups` array into the form-context `lookup` domain:
 * { [as ?? key]: data }. Returns null when there is nothing to resolve, so
 * escalations without refs cost zero SQL. Missing snapshots are omitted —
 * interpolated selects then fail closed rather than render the wrong list.
 */
export async function resolveLookupContext(
  refs: unknown,
): Promise<Record<string, unknown> | null> {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  const valid = refs.filter(isLookupRef);
  if (valid.length === 0) return null;
  const ctx: Record<string, unknown> = {};
  for (const ref of valid) {
    const snapshot = await getKnowledgeSnapshot(ref.domain, ref.key, ref.version);
    if (snapshot) ctx[ref.as ?? ref.key] = snapshot.data;
  }
  return ctx;
}

/**
 * Full per-ref resolution for the lookups endpoint: every ref answers, with
 * `missing: true` marking a pin that has no snapshot — fail-visible per ref
 * without failing the batch.
 */
export async function resolveLookupRefs(refs: EscalationLookupRef[]): Promise<ResolvedLookup[]> {
  const resolved: ResolvedLookup[] = [];
  for (const ref of refs) {
    if (!isLookupRef(ref)) continue;
    const snapshot = await getKnowledgeSnapshot(ref.domain, ref.key, ref.version);
    resolved.push({
      domain: ref.domain,
      key: ref.key,
      version: ref.version,
      ...(ref.as ? { as: ref.as } : {}),
      data: snapshot ? snapshot.data : null,
      ...(snapshot ? {} : { missing: true }),
    });
  }
  return resolved;
}
