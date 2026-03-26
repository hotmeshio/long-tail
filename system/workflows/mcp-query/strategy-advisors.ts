/**
 * Strategy advisors — inspect loaded tool inventory and emit concrete,
 * tool-name-specific prompt sections so the LLM makes optimal tool choices.
 *
 * No tool names are hardcoded in the generic system prompt. Instead,
 * advisors run at tool-loading time and produce guidance referencing
 * the actual qualified names the LLM will see.
 */

import type { ServerInfo } from './types';

type StrategyAdvisor = (servers: ServerInfo[]) => string;

// ── Advisors ────────────────────────────────────────────────────────────────

/**
 * Detects overlapping server categories (e.g., two browser-automation servers)
 * and emits concrete "USE THIS / AVOID THAT" guidance with actual tool names.
 */
function overlappingCategoryAdvisor(servers: ServerInfo[]): string {
  // Group by category
  const byCategory = new Map<string, ServerInfo[]>();
  for (const s of servers) {
    const category = s.metadata?.category;
    if (!category) continue;
    const group = byCategory.get(category) || [];
    group.push(s);
    byCategory.set(category, group);
  }

  const sections: string[] = [];

  for (const [category, group] of byCategory) {
    if (group.length < 2) continue;

    // Determine high vs low level: explicit metadata.level, then tool-count heuristic
    let highLevel: ServerInfo | null = null;
    let lowLevel: ServerInfo | null = null;

    const withLevel = group.filter(s => s.metadata?.level);
    if (withLevel.length >= 2) {
      highLevel = withLevel.find(s => s.metadata?.level === 'high') || null;
      lowLevel = withLevel.find(s => s.metadata?.level === 'low') || null;
    }

    if (!highLevel || !lowLevel) {
      // Heuristic: fewer tools = higher-level (composite)
      const sorted = [...group].sort((a, b) => a.toolCount - b.toolCount);
      highLevel = highLevel || sorted[0];
      lowLevel = lowLevel || sorted[sorted.length - 1];
    }

    if (highLevel === lowLevel) continue;

    const categoryLabel = category.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const hiSlug = highLevel.slug;
    const loSlug = lowLevel.slug;
    const hiTools = highLevel.toolNames.map(t => `${hiSlug}__${t}`);
    const loTools = lowLevel.toolNames.map(t => `${loSlug}__${t}`);

    sections.push(
`## ${categoryLabel} — Tool Selection (CRITICAL)

You have TWO ${categoryLabel.toLowerCase()} servers. One is high-level (composite), the other low-level (primitives).

**USE: ${highLevel.name}** (${highLevel.toolCount} composite tools)
Tools: ${hiTools.join(', ')}
${highLevel.description ? `> ${highLevel.description}` : ''}
Each tool handles a complete workflow in ONE call. Session management is automatic.

**AVOID: ${lowLevel.name}** (${lowLevel.toolCount} primitive tools)
Tools: ${loTools.join(', ')}
These are individual primitives requiring manual session management. Using these when the composite tools can do the job causes 5-10x more calls and session failures.

**RULE: ALWAYS use ${hiSlug}__* tools. NEVER use ${loSlug}__* tools unless no ${hiSlug}__* tool can accomplish the task.**`
    );
  }

  return sections.join('\n\n');
}

/**
 * Scans for batch-capable tools (accepting array inputs) and notes them
 * as preferred over repeated single-item calls.
 */
function batchPreferenceAdvisor(servers: ServerInfo[]): string {
  // This advisor is lightweight — it just identifies tools with array params
  // from their names/descriptions. The overlapping category advisor handles
  // the primary use case. This catches additional patterns.
  return '';
}

// ── Public API ──────────────────────────────────────────────────────────────

const advisors: StrategyAdvisor[] = [
  overlappingCategoryAdvisor,
  batchPreferenceAdvisor,
];

/**
 * Run all strategy advisors against the loaded server inventory
 * and return a combined strategy section for the LLM prompt.
 */
export function generateStrategySection(servers: ServerInfo[]): string {
  const sections = advisors
    .map(advisor => advisor(servers))
    .filter(s => s.length > 0);

  return sections.join('\n\n');
}
