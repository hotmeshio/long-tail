/**
 * Knowledge version reads. Writes live in system/activities/knowledge.ts and
 * snapshot every data change; this module reads the immutable editions those
 * writes produce, and resolves escalation lookup refs against them.
 */
import { getPool } from '../../lib/db';
import { GET_KNOWLEDGE_VERSION, LIST_KNOWLEDGE_VERSIONS } from './sql';

export * from './lookup-cache';

export interface KnowledgeVersionMeta {
  version: number;
  change_summary: string | null;
  created_at: string;
  is_current: boolean;
}

/** The immutable snapshot at (domain, key, version), uncached full shape. */
export async function getKnowledgeVersion(
  domain: string,
  key: string,
  version: number,
): Promise<{ domain: string; key: string; version: number; data: Record<string, unknown>; tags: string[]; created_at: string } | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_KNOWLEDGE_VERSION, [domain, key, version]);
  if (!rows[0]) return null;
  return {
    domain: rows[0].domain,
    key: rows[0].key,
    version: rows[0].version,
    data: (rows[0].data as Record<string, unknown>) ?? {},
    tags: (rows[0].tags as string[]) ?? [],
    created_at: rows[0].created_at.toISOString(),
  };
}

/** Every edition of an entry, newest first, with the current one marked. */
export async function listKnowledgeVersions(
  domain: string,
  key: string,
): Promise<KnowledgeVersionMeta[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_KNOWLEDGE_VERSIONS, [domain, key]);
  return rows.map((r: any) => ({
    version: r.version,
    change_summary: r.change_summary ?? null,
    created_at: r.created_at.toISOString(),
    is_current: r.is_current === true,
  }));
}
