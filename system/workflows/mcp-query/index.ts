import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  getAllTools,
  getToolInventory,
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

const SYSTEM_PROMPT = `You are a general-purpose AI assistant for Long Tail — a durable workflow system with MCP tool integration.

You have access to ALL registered MCP tools across the system. Use them to fulfill the user's request.

When answering, call the appropriate tools to accomplish the task, then respond with a JSON object:
{
  "title": "Short headline (under 60 chars)",
  "summary": "1-3 sentence overview of what was accomplished",
  "result": { ... },
  "tool_calls_made": 0
}

Tool selection:
- Tool names are prefixed with the server slug: \`server_slug__tool_name\`
- Always call tools when they can provide real data — never guess
- Chain tools when needed (e.g., navigate then screenshot, or fetch then write_file)
- If a tool fails, try an alternative approach before giving up

Return ONLY the JSON object, no markdown fences or extra text.`;

/**
 * MCP Query workflow (leaf).
 *
 * General-purpose "ask it to do anything with tools" workflow.
 * Discovers ALL available MCP tools by tag and uses an LLM agentic
 * loop to fulfill arbitrary requests. Unlike insightQuery (DB-focused),
 * mcpQuery has access to the full tool inventory: browser automation,
 * file storage, HTTP fetch, vision, workflows, and any user-registered servers.
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

  // 1. Get available tools (optionally filtered by tags)
  const tools = await getAllTools(tags);
  const inventory = await getToolInventory();

  // 2. Start the conversation
  const messages: any[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPT + `\n\n## Available MCP Servers\n\n${inventory}`,
    },
    { role: 'user', content: prompt },
  ];

  let toolCallCount = 0;

  // 3. Agentic loop: LLM decides → execute tools → feed back → repeat
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callLLM(messages, tools);

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
