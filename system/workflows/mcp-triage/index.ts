import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from '../../activities/triage';
import * as interceptorActivities from '../../../services/interceptor/activities';
import { TRIAGE_SYSTEM_PROMPT, TRIAGE_REENTRY_CONTEXT, TRIAGE_EXHAUSTED_ROUNDS } from './prompts';
import { handleFinalResponse, type TriageResponseDeps } from './response';

type ActivitiesType = typeof activities;

const {
  getUpstreamTasks,
  getEscalationHistory,
  getToolTags,
  loadTriageTools,
  callTriageTool,
  callTriageLLM,
  notifyEngineering,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const {
  ltCreateEscalation,
  ltGetTask,
  ltGetWorkflowConfig,
  ltStartWorkflow,
} = Durable.workflow.proxyActivities<typeof interceptorActivities>({
  activities: interceptorActivities,
  taskQueue: 'lt-interceptor',
  retryPolicy: { maximumAttempts: 3 },
});

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_TRIAGE;

/** Proxied activity refs passed to response handlers */
const responseDeps: TriageResponseDeps = {
  ltCreateEscalation,
  ltGetTask,
  ltGetWorkflowConfig,
  ltStartWorkflow,
  notifyEngineering,
};

// ── Workflow ─────────────────────────────────────────────────

/**
 * MCP Triage workflow (leaf).
 *
 * Activated when a human resolver flags `needsTriage` in their resolution
 * payload. Dynamically adapts to ANY workflow type using available
 * MCP tools scoped by tag affinity.
 *
 * Tool ecosystem grows over time:
 * - Built-in servers: document-vision, mcp-workflows, human-queue,
 *   workflow-compiler, db, telemetry
 * - User-registered external MCP servers
 * - Compiled YAML workflows from past triage executions
 *
 * Tools are scoped by the original workflow's `tool_tags` configuration
 * (plus base tags: workflows, compiled, database). Full tool definitions
 * are cached at the module level — only lightweight IDs flow through
 * the durable execution log.
 *
 * **First entry** (no `envelope.resolver`):
 *   1. Gather upstream tasks and escalation history
 *   2. Load scoped tools (tag-filtered, cached)
 *   3. LLM agentic loop with tool IDs
 *   4. Returns `{ correctedData }` or escalates to engineer
 *
 * **Re-entry** (has `envelope.resolver` — engineer responded):
 *   1. Engineer may have installed new tools or provided guidance
 *   2. LLM re-evaluates with fresh tool inventory
 *   3. Returns `{ correctedData }` or re-escalates
 */
export async function mcpTriage(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    escalationPayload,
    resolverPayload,
  } = envelope.data;

  // ── Re-entry: engineer responded to our escalation ──
  if (envelope.resolver) {
    const resolver = envelope.resolver as Record<string, any>;
    return runTriageLLM(envelope, {
      additionalContext: TRIAGE_REENTRY_CONTEXT.replace(
        '%RESOLVER_JSON%',
        JSON.stringify(resolver, null, 2),
      ),
    });
  }

  // ── First entry: gather context and let LLM diagnose + fix ──
  const upstreamTasks = await getUpstreamTasks(originId);
  const escalationHistory = await getEscalationHistory(originId);

  const contextParts = [
    `**Original Workflow**: \`${originalWorkflowType}\` (queue: \`${originalTaskQueue}\`)`,
    `**Origin ID**: ${originId}`,
    `**Escalation Data** (what the workflow reported when it escalated):\n\`\`\`json\n${JSON.stringify(escalationPayload, null, 2)}\n\`\`\``,
    `**Resolver Payload** (what the human submitted):\n\`\`\`json\n${JSON.stringify(resolverPayload, null, 2)}\n\`\`\``,
  ];

  if (upstreamTasks.length > 0) {
    contextParts.push(
      `**Upstream Tasks** (${upstreamTasks.length}):\n\`\`\`json\n${JSON.stringify(
        upstreamTasks.map((t) => ({
          id: t.id,
          type: t.workflow_type,
          status: t.status,
        })),
        null,
        2,
      )}\n\`\`\``,
    );
  }

  if (escalationHistory.length > 0) {
    contextParts.push(
      `**Escalation History** (${escalationHistory.length}):\n\`\`\`json\n${JSON.stringify(
        escalationHistory.map((e) => ({
          id: e.id,
          type: e.type,
          role: e.role,
          status: e.status,
          description: e.description,
        })),
        null,
        2,
      )}\n\`\`\``,
    );
  }

  return runTriageLLM(envelope, {
    additionalContext: contextParts.join('\n\n'),
  });
}

// ── LLM Agentic Loop ────────────────────────────────────────────

async function runTriageLLM(
  envelope: LTEnvelope,
  opts: { additionalContext: string },
): Promise<LTReturn> {
  const { originalWorkflowType } = envelope.data;

  // 1. Infer tool tags from the original workflow type (from config cache, no DB hit)
  const workflowTags = await getToolTags(originalWorkflowType);

  // 2. Load scoped tools with strategy advisor
  //    (Compiled workflow discovery happens in mcpTriageRouter, not here —
  //    this leaf only runs when no compiled match was found.)
  const raw = await loadTriageTools(
    workflowTags.length > 0 ? workflowTags : undefined,
  );

  // 3. Build system prompt with tool inventory
  const toolIds = raw.toolIds;
  const inventoryParts = [
    raw.strategy,
    `## Available MCP Servers\n${raw.inventory}`,
  ].filter(Boolean).join('\n\n');

  const systemPrompt = TRIAGE_SYSTEM_PROMPT(inventoryParts);

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Handle this triage request:\n\n${opts.additionalContext}`,
    },
  ];

  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Only lightweight toolIds (string[]) flow through the durable pipe
    const response = await callTriageLLM(messages, toolIds);

    // No tool calls — LLM has produced its final answer
    if (!response.tool_calls?.length) {
      return handleFinalResponse(
        response.content || '',
        envelope,
        toolCallCount,
        responseDeps,
      );
    }

    // Execute each tool call
    const fnCalls = response.tool_calls.filter(
      (tc): tc is typeof tc & {
        type: 'function';
        function: { name: string; arguments: string };
      } => tc.type === 'function',
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

      // callTool returns errors as data so the LLM can adapt
      const result = await callTriageTool(toolCall.function.name, args);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Exhausted rounds — ask for final synthesis without tools
  messages.push({
    role: 'user',
    content: TRIAGE_EXHAUSTED_ROUNDS,
  });
  const finalResponse = await callTriageLLM(messages, undefined);
  return handleFinalResponse(
    finalResponse.content || '',
    envelope,
    toolCallCount,
    responseDeps,
  );
}
