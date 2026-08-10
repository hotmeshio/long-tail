import { readFileSync, existsSync } from 'fs';
import path from 'path';

import { getPool } from '../../lib/db';
import { loggerRegistry } from '../../lib/logger';
import type { DomainDictionary } from '../../types';
import { validateDictionary } from './validate';
import { snapshotRegistries } from './write';
import { domainCache } from './read';
import { SEED_DOMAIN, GET_DOMAIN } from './sql';

/**
 * Seed the domain dictionary from a host-declared JSON file — the same
 * insert-if-absent + drift-log contract as seedWorkflowConfig/seedMcpServer.
 * The DB row is runtime truth: an existing row is never overwritten; a
 * name/version mismatch against the file logs one drift warning.
 *
 * WARN-ONLY validation: hosts commonly seed roles after long-tail boots, so
 * unknown references log warnings here (the PUT path enforces them hard).
 * Never throws — a missing or malformed file must not brick boot.
 */
export async function seedDomainDictionary(dictionaryPath: string): Promise<void> {
  const resolved = path.isAbsolute(dictionaryPath)
    ? dictionaryPath
    : path.join(process.cwd(), dictionaryPath);

  let dictionary: DomainDictionary;
  try {
    if (!existsSync(resolved)) {
      loggerRegistry.warn(`[lt-domain] domainDictionaryPath not found: ${resolved}`);
      return;
    }
    dictionary = JSON.parse(readFileSync(resolved, 'utf-8')) as DomainDictionary;
  } catch (err: any) {
    loggerRegistry.warn(`[lt-domain] dictionary file unreadable (${resolved}): ${err.message}`);
    return;
  }

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

    // Row already existed — drift check on name/version only (no deep diff).
    const existing = await getPool().query(GET_DOMAIN);
    const doc = existing.rows[0]?.doc as DomainDictionary | undefined;
    if (doc && (doc.name !== dictionary.name || doc.version !== dictionary.version)) {
      loggerRegistry.warn(
        `[lt-domain] dictionary drift: DB holds "${doc.name}" v${doc.version}, ` +
        `file declares "${dictionary.name}" v${dictionary.version} — DB is runtime truth`,
      );
    }
  } catch (err: any) {
    loggerRegistry.warn(`[lt-domain] dictionary seed failed: ${err.message}`);
  }
}
