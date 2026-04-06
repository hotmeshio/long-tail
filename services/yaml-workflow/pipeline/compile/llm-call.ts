/**
 * LLM compilation call and server tool inventory gathering.
 *
 * Calls the LLM with summarized execution steps and parses the
 * response into an EnhancedCompilationPlan.
 */

import { callLLM, hasLLMApiKey } from '../../../llm';
import { LLM_MODEL_PRIMARY } from '../../../../modules/defaults';
import type { InputFieldMeta } from '../../../../types/yaml-workflow';
import type { PatternAnnotation } from '../../pattern-detector';
import type { ExtractedStep, EnhancedCompilationPlan } from '../../types';
import { COMPILATION_PROMPT } from '../prompts';
import { summarizeSteps, truncateValue } from './summarize';
import { parsePlan } from './parse-plan';

/**
 * Gather the full tool inventory and compile hints for MCP servers used in the execution trace.
 * Returns both the tool inventory (for substitution) and per-server compile hints (for context).
 */
async function gatherServerToolInventory(
  steps: ExtractedStep[],
): Promise<{ inventory: string; compileHints: string }> {
  const serverIds = new Set<string>();
  for (const step of steps) {
    if (step.mcpServerId) serverIds.add(step.mcpServerId);
  }
  if (serverIds.size === 0) return { inventory: '', compileHints: '' };

  try {
    const mcpDbService = await import('../../../mcp/db');
    const { servers } = await mcpDbService.listMcpServers({ limit: 100 });
    const relevant = servers.filter((s: any) => serverIds.has(s.name));

    const inventoryLines: string[] = [];
    const hintLines: string[] = [];
    for (const server of relevant) {
      const tools = (server.tool_manifest || []).map((t: any) => {
        const params = t.inputSchema?.properties
          ? Object.entries(t.inputSchema.properties as Record<string, any>)
              .map(([k, v]: [string, any]) => `${k}: ${v.type || '?'}`)
              .join(', ')
          : '';
        return `    - ${t.name}(${params}): ${(t.description || '').slice(0, 120)}`;
      });
      inventoryLines.push(`  ${server.name}:`);
      inventoryLines.push(...tools);

      if (server.compile_hints) {
        hintLines.push(`  **${server.name}**: ${server.compile_hints}`);
      }
    }
    return {
      inventory: inventoryLines.join('\n'),
      compileHints: hintLines.join('\n'),
    };
  } catch {
    return { inventory: '', compileHints: '' };
  }
}

/**
 * Call the LLM to produce an EnhancedCompilationPlan.
 * Returns null if the LLM is unavailable or the call fails.
 */
export async function callCompilationLLM(
  steps: ExtractedStep[],
  originalPrompt: string,
  naiveInputs: InputFieldMeta[],
  patternAnnotations: PatternAnnotation[],
  retryHint?: string,
): Promise<EnhancedCompilationPlan | null> {
  if (!hasLLMApiKey(LLM_MODEL_PRIMARY)) return null;

  const summaries = summarizeSteps(steps);
  const { inventory: toolInventory, compileHints } = await gatherServerToolInventory(steps);

  const naiveClassification = naiveInputs.map(f => ({
    key: f.key,
    type: f.type,
    classification: f.classification,
    description: f.description,
    source_tool: f.source_tool,
    ...(f.default !== undefined ? { default_preview: truncateValue(f.default) } : {}),
  }));

  const userMessage = [
    `## Original Prompt`,
    `"${originalPrompt}"`,
    ``,
    `## Execution Steps`,
    JSON.stringify(summaries, null, 2),
    ``,
    ...(patternAnnotations.length > 0 ? [
      `## Pattern Annotations (pre-detected by static analysis)`,
      JSON.stringify(patternAnnotations, null, 2),
      ``,
    ] : []),
    `## Naive Input Classification`,
    JSON.stringify(naiveClassification, null, 2),
    ``,
    ...(compileHints ? [
      `## Tool-Specific Compilation Hints`,
      `These hints come from the MCP server definitions and describe tool-specific constraints you MUST follow:`,
      compileHints,
      ``,
    ] : []),
    ...(toolInventory ? [
      `## Available Tools (full inventory from servers used in this execution)`,
      `Use these to substitute simpler tools for iterations when the executed tool is too complex.`,
      toolInventory,
    ] : []),
    ...(retryHint ? [retryHint] : []),
  ].join('\n');

  try {
    const response = await callLLM({
      model: LLM_MODEL_PRIMARY,
      max_tokens: 4000,
      temperature: 0,
      messages: [
        { role: 'system', content: COMPILATION_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const raw = response.content || '';
    return parsePlan(raw, steps.length);
  } catch (err) {
    const { loggerRegistry } = await import('../../../logger');
    loggerRegistry.warn(`[yaml-workflow] LLM compilation failed, using mechanical fallback: ${err}`);
    return null;
  }
}
