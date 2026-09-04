/**
 * Global search bar configuration surfaced to the dashboard via /api/settings.
 *
 * Opt-in (default off). `facets` lists the metadata facet names the search
 * picklist offers; the dashboard prepends `escalationId` and `workflowId`
 * unconditionally (long-tail-owned lookups), so `facets` is only the
 * deployment's domain vocabulary. Configure through the `search` block of the
 * `start()` config, or by env (`LT_SEARCH_BAR`, `LT_SEARCH_FACETS` csv) —
 * env wins when set, so a deployment can flip the bar without a code change.
 */

// Mirrors the facet-key rule enforced by the faceted-query surface.
const FACET_KEY = /^[a-zA-Z0-9_]+$/;

export interface SearchConfig {
  enabled: boolean;
  facets: string[];
}

const DEFAULTS: SearchConfig = { enabled: false, facets: [] };

let search: SearchConfig = { ...DEFAULTS };

function sanitizeFacets(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const trimmed = n.trim();
    if (!FACET_KEY.test(trimmed)) {
      console.warn(`[lt-search] dropping invalid search facet name: '${trimmed}'`);
      continue;
    }
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/**
 * Apply the start-config block, then the env overrides. Called once at boot;
 * callable again in tests.
 */
export function configureSearch(patch?: Partial<SearchConfig>): void {
  search = {
    enabled: patch?.enabled ?? DEFAULTS.enabled,
    facets: sanitizeFacets(patch?.facets ?? DEFAULTS.facets),
  };
  const envEnabled = process.env.LT_SEARCH_BAR;
  if (envEnabled !== undefined) search.enabled = envEnabled === 'true';
  const envFacets = process.env.LT_SEARCH_FACETS;
  if (envFacets !== undefined) search.facets = sanitizeFacets(envFacets.split(','));
}

/** The resolved search configuration reported to the dashboard. */
export function getSearchConfig(): SearchConfig {
  return { enabled: search.enabled, facets: [...search.facets] };
}
