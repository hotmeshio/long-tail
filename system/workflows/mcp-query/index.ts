import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';
import { MCP_QUERY_SYSTEM_PROMPT } from './prompts';

type ActivitiesType = typeof activities;

const {
  findCompiledWorkflows,
  loadTools,
  callMcpTool,
  callLLM,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_TRIAGE;

/**
 * MCP Query workflow (leaf).
 *
 * General-purpose "ask it to do anything with tools" workflow.
 * Discovers available MCP tools by tag and uses an LLM agentic
 * loop to fulfill arbitrary requests. Unlike insightQuery (DB-focused),
 * mcpQuery has access to the full tool inventory: browser automation,
 * file storage, HTTP fetch, vision, workflows, and any user-registered servers.
 *
 * Tool definitions are cached at the module level — only lightweight
 * IDs flow through the durable execution log.
 */
export async function mcpQuery(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  const prompt = (envelope.data?.prompt || envelope.data?.question) as string;
  const tags = envelope.data?.tags as string[] | undefined;

  if (!prompt) {
    return {
      type: 'return',
      data: {
        title: 'No prompt provided',
        summary: 'Please provide a prompt describing what you want to accomplish.',
        result: null,
        tool_calls_made: 0,
      },
    };
  }

  // 1. Phase 1: Search for compiled YAML workflows that match the prompt.
  //    These are deterministic — no LLM reasoning needed, just direct execution.
  const compiled = await findCompiledWorkflows(prompt);

  // 2. Phase 2: Load raw MCP tools (optionally filtered by tags), cached + lightweight
  const raw = await loadTools(tags);

  // Merge tool IDs: compiled workflows first (preferred), then raw MCP tools
  const toolIds = [...compiled.toolIds, ...raw.toolIds];

  // Build system prompt with compiled workflows highlighted
  let serverSection = '';
  if (compiled.inventory) {
    serverSection += `## Compiled Workflows (PREFERRED — deterministic, fast)\n\n${compiled.inventory}\n\n`;
    serverSection += `## MCP Servers (use if no compiled workflow matches)\n\n${raw.inventory}`;
  } else {
    serverSection += `## Available MCP Servers\n\n${raw.inventory}`;
  }

  // 3. Start the conversation
  const messages: any[] = [
    {
      role: 'system',
      content: MCP_QUERY_SYSTEM_PROMPT + `\n\n${serverSection}`,
    },
    { role: 'user', content: prompt },
  ];

  let toolCallCount = 0;

  // 4. Agentic loop: LLM decides → execute tools → feed back → repeat
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Only lightweight toolIds (string[]) flow through the durable pipe
    const response = await callLLM(messages, toolIds);

    // If no tool calls, we have the final answer
    if (!response.tool_calls?.length) {
      const parsed = parseJsonResponse(response.content || '');
      return {
        type: 'return',
        data: {
          ...parsed,
          tool_calls_made: toolCallCount,
        },
        milestones: [
          { name: 'mcp_query', value: 'completed' },
          { name: 'tool_calls', value: String(toolCallCount) },
        ],
      };
    }

    // Execute each tool call
    const fnCalls = response.tool_calls.filter(
      (tc): tc is typeof tc & { type: 'function'; function: { name: string; arguments: string } } =>
        tc.type === 'function',
    );

    messages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: fnCalls,
    });

    for (const toolCall of fnCalls) {
      toolCallCount++;
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      const result = await callMcpTool(toolCall.function.name, args);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // If we exhausted rounds, ask for final synthesis
  const finalResponse = await callLLM(messages, undefined);
  const parsed = parseJsonResponse(finalResponse.content || '');

  return {
    type: 'return',
    data: {
      ...parsed,
      tool_calls_made: toolCallCount,
    },
    milestones: [
      { name: 'mcp_query', value: 'completed' },
      { name: 'tool_calls', value: String(toolCallCount) },
    ],
  };
}

function parseJsonResponse(content: string): Record<string, any> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      title: 'Query Complete',
      summary: cleaned || 'No response generated.',
      result: null,
    };
  }
}
