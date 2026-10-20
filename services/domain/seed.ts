import { readFileSync, existsSync } from 'fs';
import path from 'path';

import { isDeepStrictEqual } from 'node:util';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import type { DomainDictionary } from '../../types';
import { validateDictionary } from './validate';
import { snapshotRegistries } from './write';
import { domainCache } from './read';
import { SEED_DOMAIN, UPSERT_DOMAIN, GET_DOMAIN } from './sql';

/**
 * Seed the domain dictionary declared by the host: inline in the start
 * config, or in a JSON file named by path.
 *
 * Default (db-owned): the same insert-if-absent + drift-log contract as
 * seedWorkflowConfig/seedMcpServer: the DB row is runtime truth, an existing
 * row is never overwritten, and a name/version mismatch against the declared
 * document logs one drift warning.
 *
 * With `apply` (code-owned): the declared document is compared against the
 * stored one as parsed values; a changed document is written through the same
 * upsert the PUT path uses, advancing the row's version counter exactly once.
 * An identical document is a no-op.
 *
 * WARN-ONLY validation: hosts commonly seed roles after long-tail boots, so
 * unknown references log warnings here (the PUT path enforces them hard).
 * Never throws: a missing or malformed file must not brick boot.
 */
export async function seedDomainDictionary(
  source: string | DomainDictionary,
  apply = false,
): Promise<void> {
  const dictionary = typeof source === 'string' ? readDictionaryFile(source) : source;
  if (!dictionary) return;

  try {
    const registry = await snapshotRegistries();
    const { errors, warnings, dictionary: derived } = validateDictionary(dictionary, registry);
    for (const note of [...errors, ...warnings]) {
      loggerRegistry.warn(`[lt-domain] dictionary seed: ${note}`);
    }

    const { rows } = await getPool().query(SEED_DOMAIN, [JSON.stringify(derived)]);
    if (rows.length > 0) {
      domainCache.invalidate();
      loggerRegistry.info(
        `[lt-domain] dictionary seeded: ${derived.name} v${derived.version} ` +
        `(${derived.terms?.length ?? 0} terms, ${derived.runbooks?.length ?? 0} runbooks)`,
      );
      return;
    }

    const existing = await getPool().query(GET_DOMAIN);
    const doc = existing.rows[0]?.doc as DomainDictionary | undefined;

    if (apply) {
      // Code-owned: compare parsed documents (jsonb loses key order) and
      // write only on a real change — one version bump per changed file.
      if (doc && isDeepStrictEqual(doc, derived)) return;
      await getPool().query(UPSERT_DOMAIN, [JSON.stringify(derived), null]);
      domainCache.invalidate();
      loggerRegistry.info(
        `[lt-domain] dictionary applied: ${derived.name} v${derived.version} ` +
        `(${derived.terms?.length ?? 0} terms, ${derived.runbooks?.length ?? 0} runbooks)`,
      );
      return;
    }

    // Row already existed — drift check on name/version only (no deep diff).
    if (doc && (doc.name !== dictionary.name || doc.version !== dictionary.version)) {
      loggerRegistry.warn(
        `[lt-domain] dictionary drift: DB holds "${doc.name}" v${doc.version}, ` +
        `start config declares "${dictionary.name}" v${dictionary.version}; DB is runtime truth`,
      );
    }
  } catch (err: any) {
    loggerRegistry.warn(`[lt-domain] dictionary seed failed: ${err.message}`);
  }
}

/** The dictionary in a JSON file, resolved against the host cwd; null (logged) when missing or unreadable. */
function readDictionaryFile(dictionaryPath: string): DomainDictionary | null {
  const resolved = path.isAbsolute(dictionaryPath)
    ? dictionaryPath
    : path.join(process.cwd(), dictionaryPath);
  try {
    if (!existsSync(resolved)) {
      loggerRegistry.warn(`[lt-domain] domainDictionaryPath not found: ${resolved}`);
      return null;
    }
    return JSON.parse(readFileSync(resolved, 'utf-8')) as DomainDictionary;
  } catch (err: any) {
    loggerRegistry.warn(`[lt-domain] dictionary file unreadable (${resolved}): ${err.message}`);
    return null;
  }
}
