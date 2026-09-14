import { getPool } from '../../lib/db';
import type { EscalationLookupRef } from '../../types/escalation';
import { getKnowledgeSnapshot } from './lookup-cache';
import { LIST_KNOWLEDGE_VERSIONS } from './sql';

/**
 * One message per ref whose pinned edition does not exist, naming what does.
 * Shape is the caller's job (assertLookupRefs); this answers the second
 * question a saver has: is there an edition behind the pin.
 */
export async function describeMissingLookupRefs(refs: EscalationLookupRef[]): Promise<string[]> {
  const problems: string[] = [];
  for (const ref of refs) {
    const snapshot = await getKnowledgeSnapshot(ref.domain, ref.key, ref.version);
    if (snapshot) continue;
    const { rows } = await getPool().query(LIST_KNOWLEDGE_VERSIONS, [ref.domain, ref.key]);
    const versions = rows.map((r: any) => Number(r.version)).sort((a: number, b: number) => a - b);
    const where = versions.length
      ? `editions: ${versions.map((v: number) => `v${v}`).join(', ')}`
      : `no knowledge entry ${ref.domain}/${ref.key}`;
    problems.push(`Lookup ref ${ref.domain}/${ref.key} v${ref.version} names no edition (${where})`);
  }
  return problems;
}
