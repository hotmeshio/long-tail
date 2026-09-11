import { metadataFacetUrl } from './facet-url';
import type { ScanRule, ScanScheme } from '../api/scan-codes';

/** Long-tail-owned lookups — always present ahead of the configured facets. */
export const BUILT_IN_SEARCH_FACETS = ['escalationId', 'workflowId'] as const;

/** Escalation ids are UUIDs — shape-checked so a stray paste never costs a request. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SEARCH_MODE_KEY = 'lt:search:mode';
const LEGACY_FACET_KEY = 'lt:search:facet';

export const SEARCH_MODE_KINDS = {
  FACET: 'facet',
  COMMAND: 'command',
} as const;

/** One runnable scan rule, flattened with the scheme facts the bar needs. */
export interface ScanCommand {
  version: number;
  category: string;
  name: string;
  schemeName: string;
  targetFacet: string;
  encoding: ScanScheme['encoding'];
  delimiter: string;
  targetLength: number | null;
}

export type SearchMode =
  | { kind: typeof SEARCH_MODE_KINDS.FACET; facet: string }
  | { kind: typeof SEARCH_MODE_KINDS.COMMAND; command: ScanCommand };

/** The persisted pin: a facet name, or a command's scheme + category. */
export type SearchModeRef =
  | { kind: typeof SEARCH_MODE_KINDS.FACET; facet: string }
  | { kind: typeof SEARCH_MODE_KINDS.COMMAND; version: number; category: string };

export function toScanCommand(scheme: ScanScheme, rule: ScanRule): ScanCommand {
  return {
    version: scheme.version,
    category: rule.category,
    name: rule.name,
    schemeName: scheme.name,
    targetFacet: scheme.target_facet,
    encoding: scheme.encoding,
    delimiter: scheme.delimiter,
    targetLength: scheme.target_length,
  };
}

/** The code head a command contributes ahead of the typed target. */
export function commandPrefix(cmd: ScanCommand): string {
  return cmd.encoding === 'delimited'
    ? `${cmd.version}${cmd.delimiter}${cmd.category}${cmd.delimiter}`
    : `${cmd.version}${cmd.category}`;
}

/** The scan code for a command plus a typed target, or the reason it cannot be built. */
export function buildCommandCode(cmd: ScanCommand, target: string): { code: string } | { error: string } {
  if (cmd.encoding === 'delimited') {
    if (isWholeDelimitedCode(cmd, target)) return { code: target };
    return { code: `${commandPrefix(cmd)}${target}` };
  }
  if (!/^[0-9]+$/.test(target)) return { error: `${cmd.name} takes digits only` };
  const len = cmd.targetLength;
  if (len && target.length !== len && target.length !== len + 1) {
    return { error: `${cmd.name} takes ${len} digits` };
  }
  return { code: `${commandPrefix(cmd)}${target}` };
}

/** A pasted full code under this command's delimiter runs as-is instead of being prefixed. */
function isWholeDelimitedCode(cmd: ScanCommand, value: string): boolean {
  const d = cmd.delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^[1-9][0-9]${d}[0-9]${d}.+$`).test(value);
}

/**
 * The navigation target for a facet search, or null when the value needs a
 * lookup first (escalationId/workflowId resolve against the API before
 * navigating).
 */
export function buildSearchTarget(facet: string, value: string): string | null {
  if (facet === 'escalationId' || facet === 'workflowId') return null;
  return metadataFacetUrl(facet, value);
}

export function modeLabel(mode: SearchMode): string {
  return mode.kind === SEARCH_MODE_KINDS.FACET ? mode.facet : mode.command.name;
}

/** The value the input expects, named in the placeholder. */
export function modePlaceholder(mode: SearchMode): string {
  if (mode.kind === SEARCH_MODE_KINDS.COMMAND) return mode.command.targetFacet;
  if (mode.facet === 'escalationId') return 'Escalation id';
  if (mode.facet === 'workflowId') return 'Workflow id';
  return mode.facet;
}

export function toModeRef(mode: SearchMode): SearchModeRef {
  return mode.kind === SEARCH_MODE_KINDS.FACET
    ? { kind: SEARCH_MODE_KINDS.FACET, facet: mode.facet }
    : { kind: SEARCH_MODE_KINDS.COMMAND, version: mode.command.version, category: mode.command.category };
}

/**
 * The effective mode for a pin against what is currently offered: a pinned
 * facet or command still present wins; otherwise the first facet, then the
 * first command; null when the bar has nothing to offer.
 */
export function resolveSearchMode(
  ref: SearchModeRef | null,
  facets: readonly string[],
  commands: readonly ScanCommand[],
): SearchMode | null {
  if (ref?.kind === SEARCH_MODE_KINDS.FACET && facets.includes(ref.facet)) {
    return { kind: SEARCH_MODE_KINDS.FACET, facet: ref.facet };
  }
  if (ref?.kind === SEARCH_MODE_KINDS.COMMAND) {
    const command = commands.find((c) => c.version === ref.version && c.category === ref.category);
    if (command) return { kind: SEARCH_MODE_KINDS.COMMAND, command };
  }
  if (facets.length > 0) return { kind: SEARCH_MODE_KINDS.FACET, facet: facets[0] };
  if (commands.length > 0) return { kind: SEARCH_MODE_KINDS.COMMAND, command: commands[0] };
  return null;
}

export function loadSearchModeRef(): SearchModeRef | null {
  try {
    const raw = localStorage.getItem(SEARCH_MODE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SearchModeRef;
      if (parsed.kind === SEARCH_MODE_KINDS.FACET && typeof parsed.facet === 'string') return parsed;
      if (parsed.kind === SEARCH_MODE_KINDS.COMMAND && typeof parsed.version === 'number' && typeof parsed.category === 'string') return parsed;
    }
    const legacy = localStorage.getItem(LEGACY_FACET_KEY);
    return legacy ? { kind: SEARCH_MODE_KINDS.FACET, facet: legacy } : null;
  } catch {
    return null;
  }
}

export function saveSearchModeRef(ref: SearchModeRef): void {
  try {
    localStorage.setItem(SEARCH_MODE_KEY, JSON.stringify(ref));
  } catch {
    /* best-effort */
  }
}
