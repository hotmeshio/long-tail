import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_INSIGHT } from '../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../types';
import * as activities from './activities';
import { INSIGHT_SYSTEM_PROMPT } from '../../system/workflows/insight/prompts';

type ActivitiesType = typeof activities;

const {
  getDbTools,
  callDbTool,
  callLLM,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_INSIGHT;

/**
 * Insight Query workflow (leaf).
 *
 * Uses OpenAI function calling with the DB MCP server tools to answer
 * natural language questions about system state. The LLM decides which
 * tools to call, the workflow executes them as durable proxy activities,
 * and the LLM synthesizes the results into a structured JSON report.
 */
export async function insightQuery(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
  const question = envelope.data?.question as string;
  if (!question) {
    return {
      type: 'return',
      data: {
        title: 'No question provided',
        summary: 'Please provide a question to analyze.',
        sections: [],
        metrics: [],
        tool_calls_made: 0,
      },
    };
  }

  // 1. Get available DB tools
  const tools = await getDbTools();

  // 2. Start the conversation
  const messages: any[] = [
    { role: 'system', content: INSIGHT_SYSTEM_PROMPT },
    { role: 'user', content: question },
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
          { name: 'insight', value: 'completed' },
          { name: 'tool_calls', value: String(toolCallCount) },
        ],
      };
    }

    // Execute each tool call (filter to function tool calls)
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

      const result = await callDbTool(toolCall.function.name, args);

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
      { name: 'insight', value: 'completed' },
      { name: 'tool_calls', value: String(toolCallCount) },
    ],
  };
}

/**
 * Parse JSON from the LLM response, handling markdown fences and malformed output.
 */
export function parseJsonResponse(content: string): Record<string, any> {
  // Strip markdown code fences if present
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      title: 'Analysis Complete',
      summary: cleaned || 'No response generated.',
      sections: [],
      metrics: [],
    };
  }
}
