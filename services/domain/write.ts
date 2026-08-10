import { getPool } from '../../lib/db';
import { listRolesWithDetails } from '../role';
import { listWorkflowConfigs } from '../config';
import { listFacetKeys } from '../escalation/queries';
import type { DomainDictionary } from '../../types';
import { validateDictionary, type RegistrySnapshot } from './validate';
import { domainCache } from './read';
import { UPSERT_DOMAIN } from './sql';

/** Snapshot the live registries the validator compares against. */
export async function snapshotRegistries(): Promise<RegistrySnapshot> {
  const [roles, configs, facetKeys] = await Promise.all([
    listRolesWithDetails(),
    listWorkflowConfigs(),
    listFacetKeys({ global: true }),
  ]);
  return {
    roles: roles.map((r) => ({ role: r.role, entity_facet: r.entity_facet })),
    workflowTypes: configs.map((c) => c.workflow_type),
    facetKeys,
  };
}

export type PutDictionaryResult =
  | { ok: true; version: number; warnings: string[] }
  | { ok: false; reason: 'invalid'; errors: string[]; warnings: string[] }
  | { ok: false; reason: 'version_conflict' };

/**
 * Replace the dictionary (whole-doc PUT). Unknown role/workflow references
 * reject; facet warnings return alongside success. `expectedVersion` arms
 * optimistic concurrency — omit for last-write-wins.
 */
export async function putDomainDictionary(
  dictionary: DomainDictionary,
  expectedVersion?: number,
): Promise<PutDictionaryResult> {
  const registry = await snapshotRegistries();
  const { errors, warnings, dictionary: derived } = validateDictionary(dictionary, registry);
  if (errors.length) return { ok: false, reason: 'invalid', errors, warnings };

  const { rows } = await getPool().query(UPSERT_DOMAIN, [
    JSON.stringify(derived),
    expectedVersion ?? null,
  ]);
  if (rows.length === 0) return { ok: false, reason: 'version_conflict' };

  domainCache.invalidate();
  return { ok: true, version: rows[0].version, warnings };
}
