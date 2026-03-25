/**
 * Category and tag derivation for compiled workflows.
 *
 * Categories are derived dynamically from registered MCP server metadata —
 * not hardcoded. As new servers are registered, their categories and tags
 * automatically participate in workflow classification.
 */

import * as mcpDbService from '../../../mcp/db';
import { STOP_WORDS } from '../../../../modules/defaults';
import type { ExtractedStep } from '../types';

/**
 * Load category signals from registered MCP servers.
 * Each server's metadata.category becomes a category, with the server's
 * name, tags, and tool names as matching keywords.
 */
async function loadCategorySignals(): Promise<Array<{ category: string; keywords: string[] }>> {
  try {
    const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
    return servers.map(s => ({
      category: (s.metadata as any)?.category || 'general',
      keywords: [
        s.name.toLowerCase(),
        ...(s.tags || []).map(t => t.toLowerCase()),
        ...(s.tool_manifest || []).map((t: any) => t.name?.toLowerCase()).filter(Boolean),
      ],
    }));
  } catch {
    return [];
  }
}

/**
 * Derive a category for a compiled workflow based on which MCP servers
 * and tools were used in the execution trace. Queries the DB for
 * current server metadata so new servers are automatically recognized.
 */
export async function deriveCategory(steps: ExtractedStep[]): Promise<string> {
  const signals = await loadCategorySignals();

  const counts = new Map<string, number>();
  const tokens: string[] = [];
  for (const step of steps) {
    if (step.kind === 'tool') {
      tokens.push(step.toolName.toLowerCase());
      if (step.mcpServerId) tokens.push(step.mcpServerId.toLowerCase());
      for (const key of Object.keys(step.arguments)) {
        tokens.push(key.toLowerCase());
      }
    }
  }
  const signalText = tokens.join(' ');

  for (const { category, keywords } of signals) {
    const hits = keywords.filter(kw => signalText.includes(kw)).length;
    if (hits > 0) counts.set(category, (counts.get(category) || 0) + hits);
  }

  const hasLlm = steps.some(s => s.kind === 'llm');
  if (hasLlm && (counts.get('database') || counts.get('data-extraction') || 0) > 0) {
    counts.set('reporting', (counts.get('reporting') || 0) + 5);
  }

  let best = 'general';
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) { best = cat; bestCount = count; }
  }
  return best;
}

export function deriveTagsFromSteps(
  steps: ExtractedStep[],
  name: string,
  description?: string,
): string[] {
  const tags = new Set<string>();

  for (const step of steps) {
    if (step.kind === 'tool') {
      tags.add(step.toolName);
      if (step.mcpServerId) tags.add(step.mcpServerId);
      tags.add(step.source);
    }
  }

  const text = `${name} ${description || ''}`.toLowerCase();
  const keywords = text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  for (const kw of keywords) {
    tags.add(kw);
  }

  return Array.from(tags);
}
