import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_MCP_QUERY } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';
import { MCP_QUERY_SYSTEM_PROMPT } from './prompts';

type ActivitiesType = typeof activities;

const {
  loadTools,
  callMcpTool,
  callQueryLLM,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_MCP_QUERY;

/**
 * MCP Query workflow (leaf).
 *
 * Dynamic MCP tool orchestration via LLM agentic loop.
 * Discovers available MCP tools by tag and uses an LLM to
 * fulfill arbitrary requests. This workflow ONLY handles
 * dynamic execution — compiled workflow matching is done
 * by the mcpQueryRouter parent.
 *
 * Clean execution traces from this workflow are what get
 * compiled into deterministic YAML workflows.
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

  // Load raw MCP tools (no compiled workflow discovery — router handles that)
  const raw = await loadTools(tags);
  const toolIds = raw.toolIds;

  // Build system prompt: strategy first, then tool inventory
  let serverSection = '';
  if (raw.strategy) {
    serverSection += `${raw.strategy}\n\n`;
  }
  serverSection += `## Available MCP Servers\n\n${raw.inventory}`;

  const messages: any[] = [
    {
      role: 'system',
      content: MCP_QUERY_SYSTEM_PROMPT + `\n\n${serverSection}`,
    },
    { role: 'user', content: prompt },
  ];

  let toolCallCount = 0;

  // Agentic loop: LLM decides → execute tools → feed back → repeat
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callQueryLLM(messages, toolIds);

    if (!response.tool_calls?.length) {
      return buildQueryReturn(response.content || '', toolCallCount);
    }

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

  // Exhausted rounds — ask for final synthesis
  const finalResponse = await callQueryLLM(messages, undefined);
  return buildQueryReturn(finalResponse.content || '', toolCallCount, [
    { name: 'rounds_exhausted', value: 'true' },
  ]);
}

type Milestone = { name: string; value: string };

/** Build the LTReturn for a completed query, with standard + enriched milestones. */
function buildQueryReturn(
  content: string,
  toolCallCount: number,
  extraMilestones: Milestone[] = [],
): LTReturn {
  const parsed = parseJsonResponse(content);
  const milestones: Milestone[] = [
    { name: 'mcp_query', value: 'completed' },
    { name: 'tool_calls', value: String(toolCallCount) },
  ];
  if (parsed.knowledge_updated?.length) {
    milestones.push({ name: 'knowledge_updated', value: String(parsed.knowledge_updated.length) });
  }
  if (parsed.compilation_candidate) {
    milestones.push({ name: 'compilation_candidate', value: 'true' });
  }
  milestones.push(...extraMilestones);
  return {
    type: 'return',
    data: { ...parsed, tool_calls_made: toolCallCount },
    milestones,
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
