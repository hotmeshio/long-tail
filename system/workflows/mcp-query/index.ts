import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_MCP_QUERY } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';
import { MCP_QUERY_SYSTEM_PROMPT } from './prompts';

type ActivitiesType = typeof activities;

const {
  findCompiledWorkflows,
  evaluateWorkflowMatch,
  extractWorkflowInputs,
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
 * General-purpose "ask it to do anything with tools" workflow.
 * Discovers available MCP tools by tag and uses an LLM agentic
 * loop to fulfill arbitrary requests. Has access to the full tool
 * inventory: all registered MCP servers and compiled YAML workflows.
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

  // 1. Phase 1: Ranked discovery of compiled YAML workflows.
  //    FTS + tag overlap returns candidates, sorted by relevance.
  const compiled = await findCompiledWorkflows(prompt);

  // 2. Phase 2: LLM-as-judge — one cheap call to evaluate candidates.
  //    If a compiled workflow matches with high confidence, extract inputs and invoke.
  if (compiled.candidates.length > 0) {
    const match = await evaluateWorkflowMatch(prompt, compiled.candidates);

    if (match.matched && match.workflowName) {
      // Phase 2b: Extract structured inputs from the prompt using the workflow's input_schema.
      // This serves as a second confirmation — if inputs can't be mapped, fall through to dynamic.
      const candidate = compiled.candidates.find((c) => c.name === match.workflowName);
      const inputSchema = candidate?.input_schema || { type: 'object', properties: {} };

      const extraction = await extractWorkflowInputs(prompt, inputSchema, match.workflowName);

      if (extraction.extracted && extraction.inputs) {
        const qualifiedName = `yaml__${match.workflowName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const result = await callMcpTool(qualifiedName, extraction.inputs);

        return {
          type: 'return',
          data: {
            title: `Executed: ${match.workflowName}`,
            summary: `Matched compiled workflow with ${(match.confidence * 100).toFixed(0)}% confidence. Inputs extracted from prompt and passed to deterministic execution.`,
            result,
            tool_calls_made: 1,
            discovery: { method: 'compiled-workflow', confidence: match.confidence, workflowName: match.workflowName },
          },
          milestones: [
            { name: 'mcp_query', value: 'completed' },
            { name: 'discovery', value: 'compiled_match' },
            { name: 'confidence', value: String(match.confidence) },
          ],
        };
      }
      // Input extraction failed — fall through to dynamic execution
    }
  }

  // 3. Phase 3: No compiled match — load raw MCP tools (the expensive path)
  const raw = await loadTools(tags);

  // Merge tool IDs: compiled workflows first (preferred), then raw MCP tools
  const toolIds = [...compiled.toolIds, ...raw.toolIds];

  // Build system prompt: strategy FIRST (so LLM reads it before seeing tools), then inventory
  let serverSection = '';

  // Strategy section first — concrete tool-selection rules from the actual inventory
  if (raw.strategy) {
    serverSection += `${raw.strategy}\n\n`;
  }

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
    const response = await callQueryLLM(messages, toolIds);

    // If no tool calls, we have the final answer
    if (!response.tool_calls?.length) {
      const parsed = parseJsonResponse(response.content || '');
      const milestones = [
        { name: 'mcp_query', value: 'completed' },
        { name: 'tool_calls', value: String(toolCallCount) },
      ];
      if (parsed.knowledge_updated?.length) {
        milestones.push({ name: 'knowledge_updated', value: String(parsed.knowledge_updated.length) });
      }
      if (parsed.compilation_candidate) {
        milestones.push({ name: 'compilation_candidate', value: 'true' });
      }
      return {
        type: 'return',
        data: {
          ...parsed,
          tool_calls_made: toolCallCount,
        },
        milestones,
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
  const finalResponse = await callQueryLLM(messages, undefined);
  const parsed = parseJsonResponse(finalResponse.content || '');
  const finalMilestones = [
    { name: 'mcp_query', value: 'completed' },
    { name: 'tool_calls', value: String(toolCallCount) },
    { name: 'rounds_exhausted', value: 'true' },
  ];
  if (parsed.knowledge_updated?.length) {
    finalMilestones.push({ name: 'knowledge_updated', value: String(parsed.knowledge_updated.length) });
  }

  return {
    type: 'return',
    data: {
      ...parsed,
      tool_calls_made: toolCallCount,
    },
    milestones: finalMilestones,
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
