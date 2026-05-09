import type { ActivityManifestEntry } from '../../../api/types';

// ── Colors ──────────────────────────────────────────────────────────────────

const SOURCE_STYLES: Record<string, { bar: string; dot: string; hex: string; label: string }> = {
  trigger:   { bar: 'bg-[#6C47FF]',  dot: 'bg-[#6C47FF]',  hex: '#6C47FF', label: 'Trigger' },
  mcp:       { bar: 'bg-blue-500',    dot: 'bg-blue-500',    hex: '#3B82F6', label: 'MCP' },
  db:        { bar: 'bg-blue-500',    dot: 'bg-blue-500',    hex: '#3B82F6', label: 'Database' },
  llm:       { bar: 'bg-violet-500',  dot: 'bg-violet-500',  hex: '#8B5CF6', label: 'LLM' },
  transform: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', hex: '#10B981', label: 'Transform' },
  signal:    { bar: 'bg-amber-500',   dot: 'bg-amber-500',   hex: '#F59E0B', label: 'Signal' },
};

export function styleFor(source: string) {
  return SOURCE_STYLES[source] ?? { bar: 'bg-gray-500', dot: 'bg-gray-500', hex: '#6B7280', label: source };
}

// ── Graph helpers ───────────────────────────────────────────────────────────

export interface Edge { from: string; to: string }

/** Recursively extract `{activityId.…}` refs from a mapping value (string or @pipe object). */
function extractMappingRefs(value: unknown): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(/\{([\w-]+)\./g)].map((m) => m[1]);
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractMappingRefs);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(extractMappingRefs);
  }
  return [];
}

/**
 * Extract `{activityId.…}` refs from YAML input.maps sections.
 * The YAML is the source of truth — manifest input_mappings may flatten
 * nested objects to summary strings, losing dependency references.
 */
function extractYamlRefs(yaml: string | undefined, activityId: string): string[] {
  if (!yaml) return [];
  // Find the maps: block for this activity by locating its ID in the YAML
  const actIdx = yaml.indexOf(`${activityId}:`);
  if (actIdx === -1) return [];
  // Find the next activity block (next line at same/lower indent with ":")
  const afterAct = yaml.slice(actIdx);
  const mapsIdx = afterAct.indexOf('maps:');
  if (mapsIdx === -1) return [];
  // Grab everything from maps: to the next sibling key (output:, job:, or next activity)
  const afterMaps = afterAct.slice(mapsIdx);
  const endMatch = afterMaps.match(/\n {6,10}\w+:|^\n {0,8}\w+:/m);
  const mapsBlock = endMatch ? afterMaps.slice(0, afterMaps.indexOf(endMatch[0], 1)) : afterMaps;
  return [...mapsBlock.matchAll(/\{([\w-]+)\./g)].map((m) => m[1]);
}

/** Derive dependency edges by parsing `{activityId.…}` refs in input_mappings and YAML. */
export function deriveEdges(entries: ActivityManifestEntry[], yaml?: string): Edge[] {
  const idSet = new Set(entries.map((e) => e.activity_id));
  const edgeMap = new Map<string, Edge>();

  for (const entry of entries) {
    // Collect refs from manifest input_mappings
    const manifestRefs = entry.input_mappings
      ? Object.values(entry.input_mappings).flatMap(extractMappingRefs)
      : [];
    // Supplement with refs from YAML (catches nested objects the manifest may have flattened)
    const yamlRefs = extractYamlRefs(yaml, entry.activity_id);
    const allRefs = new Set([...manifestRefs, ...yamlRefs]);

    for (const src of allRefs) {
      if (idSet.has(src) && src !== entry.activity_id) {
        const key = `${src}->${entry.activity_id}`;
        if (!edgeMap.has(key)) edgeMap.set(key, { from: src, to: entry.activity_id });
      }
    }
  }

  return [...edgeMap.values()];
}

/** Longest-path layering — each node's layer = max(dependency layers) + 1. */
export function assignLayers(entries: ActivityManifestEntry[], edges: Edge[]): Map<string, number> {
  const inDeps = new Map<string, string[]>();
  for (const e of entries) inDeps.set(e.activity_id, []);
  for (const edge of edges) inDeps.get(edge.to)?.push(edge.from);

  const layers = new Map<string, number>();

  function computeLayer(id: string, stack: Set<string>): number {
    if (layers.has(id)) return layers.get(id)!;
    if (stack.has(id)) return 0; // cycle guard
    stack.add(id);
    const deps = inDeps.get(id) ?? [];
    const layer = deps.length === 0 ? 0 : Math.max(...deps.map((d) => computeLayer(d, stack))) + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const e of entries) computeLayer(e.activity_id, new Set());
  return layers;
}

// ── Layout constants ────────────────────────────────────────────────────────

export const ROW_H = 44;
export const BAR_TOP = 10;
export const BAR_H = 24;
export const LABEL_REM = 14; // w-56 = 14rem
