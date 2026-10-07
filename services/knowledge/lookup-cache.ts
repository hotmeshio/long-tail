/**
 * Lookup snapshot cache — keeps escalation lookup resolution off the SQL hot
 * path. An edition {domain, key, version} is immutable, so snapshots cache
 * indefinitely under an LRU bound. A pinned ref resolves from memory after
 * the first read; a current ref costs one indexed read to learn which
 * edition is newest, then shares the same cache. Missing snapshots are never
 * cached — a later seed or republish must become visible.
 */
import { getPool } from '../../lib/db';
import { isCurrentLookupRef, type EscalationLookupRef } from '../../types/escalation';
import { GET_KNOWLEDGE_VERSION, GET_LATEST_KNOWLEDGE_VERSION } from './sql';

const SNAPSHOT_CACHE_MAX_ENTRIES = 256;

interface KnowledgeSnapshot {
  data: Record<string, unknown>;
  tags: string[];
}

export interface ResolvedLookup {
  domain: string;
  key: string;
  /** The edition served; null when a current ref found no edition. */
  version: number | null;
  /** The ref follows the newest edition rather than pinning one. */
  current?: true;
  as?: string;
  data: Record<string, unknown> | null;
  missing?: boolean;
}

// Map preserves insertion order — delete+set on read keeps it LRU.
const snapshotCache = new Map<string, KnowledgeSnapshot>();

function remember(cacheKey: string, snapshot: KnowledgeSnapshot): void {
  snapshotCache.set(cacheKey, snapshot);
  while (snapshotCache.size > SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldest = snapshotCache.keys().next().value as string;
    snapshotCache.delete(oldest);
  }
}

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
  remember(cacheKey, snapshot);
  return snapshot;
}

/**
 * The edition a ref names: its pin, or for a current ref the newest edition
 * (the newest at `asOf` when given, so a closed row reads what was current
 * when it closed). Null when there is none.
 */
export async function resolveRefEdition(
  ref: EscalationLookupRef,
  asOf?: string | null,
): Promise<{ version: number; snapshot: KnowledgeSnapshot } | null> {
  if (!isCurrentLookupRef(ref)) {
    const version = ref.version as number;
    const snapshot = await getKnowledgeSnapshot(ref.domain, ref.key, version);
    return snapshot ? { version, snapshot } : null;
  }
  const { rows } = await getPool().query(GET_LATEST_KNOWLEDGE_VERSION, [ref.domain, ref.key, asOf ?? null]);
  if (!rows[0]) return null;
  const version = Number(rows[0].version);
  const cacheKey = `${ref.domain} ${ref.key} ${version}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached) return { version, snapshot: cached };
  const snapshot: KnowledgeSnapshot = {
    data: (rows[0].data as Record<string, unknown>) ?? {},
    tags: (rows[0].tags as string[]) ?? [],
  };
  remember(cacheKey, snapshot);
  return { version, snapshot };
}

/** Structural check for one ref — malformed entries in stored metadata are skipped, not fatal. */
function isLookupRef(ref: unknown): ref is EscalationLookupRef {
  if (!ref || typeof ref !== 'object') return false;
  const r = ref as Record<string, unknown>;
  return typeof r.domain === 'string' && r.domain.length > 0
    && typeof r.key === 'string' && r.key.length > 0
    && (isCurrentLookupRef(r) || (typeof r.version === 'number' && Number.isInteger(r.version) && r.version >= 1))
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
  asOf?: string | null,
): Promise<Record<string, unknown> | null> {
  if (!Array.isArray(refs) || refs.length === 0) return null;
  const valid = refs.filter(isLookupRef);
  if (valid.length === 0) return null;
  const ctx: Record<string, unknown> = {};
  for (const ref of valid) {
    const edition = await resolveRefEdition(ref, asOf);
    if (edition) ctx[ref.as ?? ref.key] = edition.snapshot.data;
  }
  return ctx;
}

/**
 * Full per-ref resolution for the lookups endpoint: every ref answers, with
 * `missing: true` marking a pin that has no snapshot — fail-visible per ref
 * without failing the batch.
 */
export async function resolveLookupRefs(
  refs: EscalationLookupRef[],
  asOf?: string | null,
): Promise<ResolvedLookup[]> {
  const resolved: ResolvedLookup[] = [];
  for (const ref of refs) {
    if (!isLookupRef(ref)) continue;
    const current = isCurrentLookupRef(ref);
    const edition = await resolveRefEdition(ref, asOf);
    resolved.push({
      domain: ref.domain,
      key: ref.key,
      version: edition?.version ?? (current ? null : (ref.version as number)),
      ...(current ? { current: true as const } : {}),
      ...(ref.as ? { as: ref.as } : {}),
      data: edition ? edition.snapshot.data : null,
      ...(edition ? {} : { missing: true }),
    });
  }
  return resolved;
}
