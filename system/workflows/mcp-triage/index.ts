import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from '../../activities/triage';
import * as interceptorActivities from '../../../services/interceptor/activities';
import { TRIAGE_SYSTEM_PROMPT, TRIAGE_REENTRY_CONTEXT, TRIAGE_EXHAUSTED_ROUNDS } from './prompts';
import { handleFinalResponse } from './response';
import type { TriageResponseDeps } from './types';
import { sanitizeToolResult } from '../tool-result-guard';

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
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

const {
  ltCreateEscalation,
  ltCreateTask,
  ltGetTask,
  ltGetWorkflowConfig,
  ltStartWorkflow,
  ltEnrichEscalationRouting,
} = Durable.workflow.proxyActivities<typeof interceptorActivities>({
  activities: interceptorActivities,
  taskQueue: 'lt-interceptor',
  retry: { maximumAttempts: 3 },
});

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_TRIAGE;

/** Proxied activity refs passed to response handlers */
const responseDeps: TriageResponseDeps = {
  ltCreateEscalation,
  ltCreateTask,
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
 * - Built-in servers: translation, vision, mcp-workflows, human-queue,
 *   workflow-compiler, db, http-fetch, file-storage, oauth, claude-code
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
  const context = buildTriageContext(envelope.data, upstreamTasks, escalationHistory);

  return runTriageLLM(envelope, { additionalContext: context });
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

  // Repeated-error circuit breaker
  const MAX_REPEATED_ERRORS = 2;
  let lastErrorKey = '';
  let repeatedErrorCount = 0;

  const BUDGET_WARNING_THRESHOLD = 3;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const remaining = MAX_TOOL_ROUNDS - round;

    // Inject budget warning when approaching the limit
    if (remaining <= BUDGET_WARNING_THRESHOLD && remaining < MAX_TOOL_ROUNDS) {
      messages.push({
        role: 'user',
        content: `[Rounds: ${remaining} remaining] Wrap up: consolidate your diagnosis and return your final JSON response.`,
      });
    }

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

    let roundHadError = false;

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

      const resultStr = sanitizeToolResult(result);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultStr,
      });

      // Track repeated errors: same tool + same error = stuck
      const isError = resultStr.includes('MCP error') || resultStr.includes('"error"');
      if (isError) {
        roundHadError = true;
        const errorKey = `${toolCall.function.name}::${resultStr.slice(0, 200)}`;
        if (errorKey === lastErrorKey) {
          repeatedErrorCount++;
        } else {
          lastErrorKey = errorKey;
          repeatedErrorCount = 1;
        }

        if (repeatedErrorCount >= MAX_REPEATED_ERRORS) {
          messages.push({
            role: 'user',
            content: `[CIRCUIT BREAKER] The tool "${toolCall.function.name}" has returned the same error ${repeatedErrorCount} times. Stop retrying this tool. Summarize your diagnosis and what failed.`,
          });
          const bailResponse = await callTriageLLM(messages, undefined);
          return handleFinalResponse(
            bailResponse.content || '',
            envelope,
            toolCallCount,
            responseDeps,
          );
        }
      }
    }

    if (!roundHadError) {
      lastErrorKey = '';
      repeatedErrorCount = 0;
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

// ── Context builders ─────────────────────────────────────────────

/** Assemble the triage context string from workflow lineage and history. */
function buildTriageContext(
  data: Record<string, any>,
  upstreamTasks: any[],
  escalationHistory: any[],
): string {
  const parts = [
    `**Original Workflow**: \`${data.originalWorkflowType}\` (queue: \`${data.originalTaskQueue}\`)`,
    `**Origin ID**: ${data.originId}`,
    `**Escalation Data** (what the workflow reported when it escalated):\n\`\`\`json\n${JSON.stringify(data.escalationPayload, null, 2)}\n\`\`\``,
    `**Resolver Payload** (what the human submitted):\n\`\`\`json\n${JSON.stringify(data.resolverPayload, null, 2)}\n\`\`\``,
  ];

  if (upstreamTasks.length > 0) {
    parts.push(
      `**Upstream Tasks** (${upstreamTasks.length}):\n\`\`\`json\n${JSON.stringify(
        upstreamTasks.map((t) => ({ id: t.id, type: t.workflow_type, status: t.status })),
        null, 2,
      )}\n\`\`\``,
    );
  }

  if (escalationHistory.length > 0) {
    parts.push(
      `**Escalation History** (${escalationHistory.length}):\n\`\`\`json\n${JSON.stringify(
        escalationHistory.map((e) => ({ id: e.id, type: e.type, role: e.role, status: e.status, description: e.description })),
        null, 2,
      )}\n\`\`\``,
    );
  }

  return parts.join('\n\n');
}
