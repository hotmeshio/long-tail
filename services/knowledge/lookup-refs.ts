import { getPool } from '../../lib/db';
import { isCurrentLookupRef, type EscalationLookupRef } from '../../types/escalation';
import { resolveRefEdition } from './lookup-cache';
import { LIST_KNOWLEDGE_VERSIONS } from './sql';

/**
 * One message per ref with no edition behind it (a pin that does not exist,
 * or a current ref to an entry with no editions), naming what does.
 * Shape is the caller's job (assertLookupRefs); this answers the second
 * question a saver has: is there an edition behind the pin.
 */
export async function describeMissingLookupRefs(refs: EscalationLookupRef[]): Promise<string[]> {
  const problems: string[] = [];
  for (const ref of refs) {
    if (await resolveRefEdition(ref)) continue;
    const { rows } = await getPool().query(LIST_KNOWLEDGE_VERSIONS, [ref.domain, ref.key]);
    const versions = rows.map((r: any) => Number(r.version)).sort((a: number, b: number) => a - b);
    const where = versions.length
      ? `editions: ${versions.map((v: number) => `v${v}`).join(', ')}`
      : `no knowledge entry ${ref.domain}/${ref.key}`;
    const named = isCurrentLookupRef(ref) ? 'current' : `v${ref.version}`;
    problems.push(`Lookup ref ${ref.domain}/${ref.key} ${named} names no edition (${where})`);
  }
  return problems;
}
