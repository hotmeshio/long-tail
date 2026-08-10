import type { DomainDictionary, DomainTerm } from '../../types';

/**
 * Reference validation for the domain dictionary — pure, registry-injected.
 *
 * Roles and workflows are HARD registries: an unknown reference is an error
 * (the PUT path rejects with 422; the boot seed downgrades errors to warnings
 * because hosts may seed roles after long-tail boots). Facet keys are
 * DATA-derived — a legitimate facet may simply have no rows yet — so unknown
 * facets are always warnings. Entity terms without an explicit idFacet get one
 * DERIVED from their role's entity_facet.
 */

/** The minimal live-registry snapshot the validator compares against. */
export interface RegistrySnapshot {
  roles: Array<{ role: string; entity_facet: string | null }>;
  workflowTypes: string[];
  facetKeys: string[];
}

export interface DictionaryValidation {
  /** Unknown role/workflow references — reject on write, warn at seed. */
  errors: string[];
  /** Unknown facet keys and other non-fatal notes. */
  warnings: string[];
  /** The dictionary with derived fields filled (entity idFacet). */
  dictionary: DomainDictionary;
}

const KINDS = new Set(['entity', 'role', 'workflow', 'facet', 'action', 'rule']);

function rolesOf(term: DomainTerm): string[] {
  const out: string[] = [];
  if (term.maps_to?.role) out.push(term.maps_to.role);
  if (term.maps_to?.roles) out.push(...term.maps_to.roles);
  return out;
}

export function validateDictionary(
  dictionary: DomainDictionary,
  registry: RegistrySnapshot,
): DictionaryValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownRoles = new Map(registry.roles.map((r) => [r.role, r]));
  const knownWorkflows = new Set(registry.workflowTypes);
  const knownFacets = new Set(registry.facetKeys);

  if (!dictionary.name || !dictionary.overview) {
    errors.push('dictionary requires name and overview');
  }

  const terms = (dictionary.terms ?? []).map((t): DomainTerm => {
    const at = `terms["${t.term}"]`;
    if (!KINDS.has(t.kind)) {
      errors.push(`${at}: unknown kind "${t.kind}"`);
    }
    for (const role of rolesOf(t)) {
      if (!knownRoles.has(role)) {
        errors.push(`${at}: role "${role}" is not a live role`);
      }
    }
    if (t.maps_to?.workflow && !knownWorkflows.has(t.maps_to.workflow)) {
      errors.push(`${at}: workflow "${t.maps_to.workflow}" is not a registered workflow`);
    }
    if (t.maps_to?.facet && !knownFacets.has(t.maps_to.facet)) {
      warnings.push(`${at}: facet "${t.maps_to.facet}" is not (yet) a known metadata facet`);
    }
    // Derive the entity's id facet from its role's entity_facet when omitted.
    if (t.kind === 'entity' && !t.idFacet) {
      const derived = rolesOf(t)
        .map((role) => knownRoles.get(role)?.entity_facet)
        .find((f): f is string => !!f);
      if (derived) return { ...t, idFacet: derived };
      warnings.push(`${at}: entity has no idFacet and none derivable from its roles`);
    }
    return t;
  });

  return { errors, warnings, dictionary: { ...dictionary, terms } };
}
