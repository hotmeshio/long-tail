/**
 * Helper functions for the extract pipeline stage.
 *
 * Parsing utilities for MCP activity types, tool arguments,
 * LLM messages, and default prompt construction.
 */

import type { ExtractedStep } from '../types';
import { EXTRACT_DEFAULT_SYSTEM_PROMPT, EXTRACT_DEFAULT_USER_TEMPLATE } from './prompts';

/**
 * Parse an MCP activity type name back into server name + tool name.
 * Activity names follow: mcp_{serverName}_{toolName}
 */
export function parseMcpActivityType(activityType: string): {
  serverName: string;
  toolName: string;
} {
  const rest = activityType.slice(4);
  const firstUnderscore = rest.indexOf('_');
  if (firstUnderscore === -1) {
    return { serverName: rest, toolName: rest };
  }
  return {
    serverName: rest.slice(0, firstUnderscore),
    toolName: rest.slice(firstUnderscore + 1),
  };
}

/**
 * Extract the tool arguments from an enriched activity event's input.
 *
 * The enriched `input` field contains the raw arguments passed to the
 * activity function. The shape depends on the activity:
 * - callMcpTool(qualifiedName, args) → [qualifiedName, args]
 * - callDbTool(name, args) → [name, args]
 * - callLLM(messages, tools?) → [messages, tools?]
 * - mcp_* activities(args) → [args]
 */
export function extractToolArgs(attrs: Record<string, unknown>): Record<string, unknown> {
  const input = attrs.input as unknown[] | undefined;
  if (!input || !Array.isArray(input)) return {};

  // callMcpTool / callTriageTool / callDbTool / callVisionTool: [name, args]
  if (['callMcpTool', 'callTriageTool', 'callDbTool', 'callVisionTool'].includes(attrs.activity_type as string)) {
    const args = input[1];
    return (args && typeof args === 'object' && !Array.isArray(args))
      ? args as Record<string, unknown>
      : {};
  }

  // mcp_* activities: [args] (single argument — the tool parameters)
  if ((attrs.activity_type as string)?.startsWith('mcp_')) {
    const args = input[0];
    return (args && typeof args === 'object' && !Array.isArray(args))
      ? args as Record<string, unknown>
      : {};
  }

  return {};
}

/**
 * Extract the LLM prompt messages from an enriched callLLM event's input.
 * callLLM(messages, tools?) → input = [messages, tools?]
 */
export function extractLlmMessages(attrs: Record<string, unknown>): Array<{ role: string; content: string }> | undefined {
  const input = attrs.input as unknown[] | undefined;
  if (!input || !Array.isArray(input) || input.length === 0) return undefined;
  const messages = input[0];
  if (!Array.isArray(messages)) return undefined;
  return messages.filter((m: any) => m?.role && m?.content) as Array<{ role: string; content: string }>;
}

/**
 * Build a default prompt template referencing the data available from prior tool steps.
 * The prompt uses {field} placeholders that map to input_maps at runtime.
 */
export function buildDefaultPrompt(priorSteps: ExtractedStep[]): Array<{ role: string; content: string }> {
  const lastToolStep = [...priorSteps].reverse().find((s) => s.kind === 'tool');
  const fields = lastToolStep?.result && typeof lastToolStep.result === 'object' && !Array.isArray(lastToolStep.result)
    ? Object.keys(lastToolStep.result as Record<string, unknown>)
    : [];

  const dataRef = fields.length > 0
    ? `The data includes the following fields: ${fields.join(', ')}.`
    : 'Analyze the provided data.';

  return [
    { role: 'system', content: EXTRACT_DEFAULT_SYSTEM_PROMPT },
    { role: 'user', content: EXTRACT_DEFAULT_USER_TEMPLATE.replace('{dataRef}', dataRef) },
  ];
}
