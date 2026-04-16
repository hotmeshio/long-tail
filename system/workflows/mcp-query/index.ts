import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_MCP_QUERY } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';
import * as interceptorActivities from '../../../services/interceptor/activities';
import { MCP_QUERY_SYSTEM_PROMPT, ROUNDS_EXHAUSTED_DIAGNOSTIC_PROMPT } from './prompts';
import { sanitizeToolResult } from '../tool-result-guard';

type ActivitiesType = typeof activities;

const {
  loadTools,
  callMcpTool,
  callQueryLLM,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const {
  ltEnrichEscalationRouting,
} = Durable.workflow.proxyActivities<typeof interceptorActivities>({
  activities: interceptorActivities,
  taskQueue: 'lt-interceptor',
  retry: { maximumAttempts: 3 },
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
  ];

  // If this is a re-run after triage, inject triage learnings as context
  const triageContext = (envelope.resolver as any)?._triageContext;
  if (triageContext) {
    const triageHints = [
      `This is a re-run after a previous attempt failed and was triaged.`,
      triageContext.diagnosis ? `Previous diagnosis: ${triageContext.diagnosis}` : '',
      triageContext.actions_taken?.length ? `Actions already taken: ${triageContext.actions_taken.join('; ')}` : '',
      triageContext.recommendation ? `Recommendation: ${triageContext.recommendation}` : '',
    ].filter(Boolean).join('\n');
    messages.push({ role: 'user', content: triageHints });
    messages.push({ role: 'assistant', content: 'Understood. I will use these learnings to take a more targeted approach this time.' });
  }

  // If invoked from the help assistant, inject dashboard context
  const dashContext = envelope.data?.context as Record<string, any> | undefined;
  if (dashContext) {
    const lines = [
      `[Dashboard Context]`,
      `Page: ${dashContext.page || 'unknown'}`,
      dashContext.entities?.workflowId ? `Workflow: ${dashContext.entities.workflowId}` : '',
      dashContext.entities?.workflowStatus ? `Status: ${dashContext.entities.workflowStatus}` : '',
      dashContext.entities?.yamlContent ? `YAML:\n${dashContext.entities.yamlContent}` : '',
      dashContext.entities?.prompt ? `Original query: ${dashContext.entities.prompt}` : '',
      ``,
      `IMPORTANT: This is a help assistant conversation. Always include the actual data, content, and results from tool calls in your response. Do not just confirm an action was taken — show the user what was retrieved, stored, or produced.`,
      `[End Context]`,
    ].filter(Boolean).join('\n');
    messages.push({ role: 'user', content: lines });
    messages.push({ role: 'assistant', content: 'I have the dashboard context. I will always show actual data and results, not just confirmations.' });
  }

  messages.push({ role: 'user', content: prompt });

  let toolCallCount = 0;

  // Agentic loop: LLM decides → execute tools → feed back → repeat
  const BUDGET_WARNING_THRESHOLD = 3;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const remaining = MAX_TOOL_ROUNDS - round;

    // Inject budget warning when approaching the limit
    if (remaining <= BUDGET_WARNING_THRESHOLD && remaining < MAX_TOOL_ROUNDS) {
      messages.push({
        role: 'user',
        content: `[Rounds: ${remaining} remaining] Wrap up: consolidate results and return your final JSON response. Do not start new multi-step work.`,
      });
    }

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

      // Durable waitFor: if the tool returns a signal, pause until human responds
      if (result?.type === 'waitFor' && result?.signalId) {
        const ctx = Durable.workflow.workflowInfo();
        const workflowType = ctx.workflowTopic.replace(`${ctx.taskQueue}-`, '');
        await ltEnrichEscalationRouting({
          escalationId: result.escalationId,
          signalRouting: {
            taskQueue: ctx.taskQueue,
            workflowType,
            workflowId: ctx.workflowId,
            signalId: result.signalId,
          },
          claimForUserId: envelope.lt?.userId,
        });
        const signalData = await Durable.workflow.condition<Record<string, any>>(result.signalId);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(signalData),
        });
        continue;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: sanitizeToolResult(result),
      });
    }
  }

  // Exhausted rounds — ask LLM for diagnostic summary
  messages.push({
    role: 'user',
    content: ROUNDS_EXHAUSTED_DIAGNOSTIC_PROMPT,
  });
  const finalResponse = await callQueryLLM(messages, undefined);
  const parsed = parseJsonResponse(finalResponse.content || '');
  return {
    type: 'return',
    data: {
      ...parsed,
      tool_calls_made: toolCallCount,
      rounds_exhausted: true,
    },
    milestones: [
      { name: 'mcp_query', value: 'completed' },
      { name: 'tool_calls', value: String(toolCallCount) },
      { name: 'rounds_exhausted', value: 'true' },
    ],
  };
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
