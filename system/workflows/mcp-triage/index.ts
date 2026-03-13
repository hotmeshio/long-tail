import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from '../../activities/triage';
import { TRIAGE_SYSTEM_PROMPT, TRIAGE_REENTRY_CONTEXT, TRIAGE_EXHAUSTED_ROUNDS } from './prompts';

type ActivitiesType = typeof activities;

const {
  getUpstreamTasks,
  getEscalationHistory,
  getToolInventory,
  getAvailableTools,
  callTool,
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

const MAX_TOOL_ROUNDS = TOOL_ROUNDS_TRIAGE;

// ── Workflow ─────────────────────────────────────────────────

/**
 * MCP Triage workflow (leaf).
 *
 * Activated when a human resolver flags `needsTriage` in their resolution
 * payload. Dynamically adapts to ANY workflow type using ALL available
 * MCP tools.
 *
 * Tool ecosystem grows over time:
 * - Built-in servers: document-vision, mcp-workflows, human-queue,
 *   workflow-compiler, db, telemetry
 * - User-registered external MCP servers
 * - Compiled YAML workflows from past triage executions
 *
 * The triage agent checks compiled workflows first (cheapest path),
 * falls back to raw tool calls, and escalates to engineering with
 * specific tool recommendations when it lacks the right capabilities.
 *
 * **First entry** (no `envelope.resolver`):
 *   1. Gather upstream tasks and escalation history
 *   2. Build tool inventory for the LLM system prompt
 *   3. LLM agentic loop with all MCP tools
 *   4. Returns `{ correctedData }` or escalates to engineer
 *
 * **Re-entry** (has `envelope.resolver` — engineer responded):
 *   1. Engineer may have installed new tools or provided guidance
 *   2. LLM re-evaluates with fresh tool inventory
 *   3. Returns `{ correctedData }` or re-escalates
 */
export async function mcpTriage(
  envelope: LTEnvelope,
): Promise<LTReturn | LTEscalation> {
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
): Promise<LTReturn | LTEscalation> {
  // Build tool inventory for the system prompt (compact, no round-trip per server)
  const toolInventory = await getToolInventory();
  const systemPrompt = TRIAGE_SYSTEM_PROMPT(toolInventory);

  // Load all tools for function calling
  const tools = await getAvailableTools();
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Handle this triage request:\n\n${opts.additionalContext}`,
    },
  ];

  let toolCallCount = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callTriageLLM(messages, tools);

    // No tool calls — LLM has produced its final answer
    if (!response.tool_calls?.length) {
      return handleFinalResponse(
        response.content || '',
        envelope,
        toolCallCount,
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
      const result = await callTool(toolCall.function.name, args);

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
  );
}

// ── Response handling ───────────────────────────────────────────

async function handleFinalResponse(
  content: string,
  envelope: LTEnvelope,
  toolCallCount: number,
): Promise<LTReturn | LTEscalation> {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    escalationPayload,
  } = envelope.data;

  const parsed = parseTriageResponse(content);

  if (parsed.correctedData) {
    // Success — LLM fixed the issue
    if (parsed.recommendation) {
      await notifyEngineering(
        originId,
        `Triage auto-remediation for ${originalWorkflowType}: ${parsed.diagnosis || 'issue resolved'}. ` +
          `Recommendation: ${parsed.recommendation}`,
        {
          actions_taken: parsed.actions_taken,
          tool_calls: toolCallCount,
          confidence: parsed.confidence,
        },
      );
    }

    return {
      type: 'return',
      data: {
        correctedData: {
          ...escalationPayload,
          ...parsed.correctedData,
        },
        originalWorkflowType,
        originalTaskQueue,
        originId,
        diagnosis: parsed.diagnosis,
        actions_taken: parsed.actions_taken,
        tool_calls_made: toolCallCount,
        confidence: parsed.confidence,
        needsHumanReview: parsed.needsHumanReview || false,
      },
      milestones: [
        { name: 'triage', value: 'completed' },
        { name: 'triage_method', value: toolCallCount > 0 ? 'llm_with_tools' : 'llm_direct' },
        { name: 'tool_calls', value: String(toolCallCount) },
      ],
    };
  }

  // LLM couldn't fix — escalate to engineer with full diagnosis + recommendations
  const recommendation = parsed.recommendation || '';
  const escalationMessage = [
    `AI triage could not resolve the issue for ${originalWorkflowType} (origin: ${originId}).`,
    `Diagnosis: ${parsed.diagnosis || 'unknown'}.`,
    `${toolCallCount} tool call(s) made.`,
    recommendation ? `\nRecommendation: ${recommendation}` : '',
    `\nTo continue: install/configure any recommended MCP tools, then resolve this ` +
    `escalation with a message like "tools ready, try again" or provide specific guidance.`,
  ].filter(Boolean).join(' ');

  return {
    type: 'escalation',
    data: {
      originId,
      originalWorkflowType,
      originalTaskQueue,
      originalTaskId: envelope.data.originalTaskId,
      escalationPayload,
      diagnosis: parsed.diagnosis || 'AI triage could not determine a fix',
      actions_taken: parsed.actions_taken || [],
      tool_calls_made: toolCallCount,
      recommendation,
    },
    message: escalationMessage,
    role: 'engineer',
    priority: 2,
  };
}

function parseTriageResponse(content: string): Record<string, any> {
  // Strip markdown fences if present
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  // Try to extract JSON from the response — the LLM might include extra text
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find a JSON object embedded in the text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch { /* fall through */ }
    }

    return {
      diagnosis: cleaned || 'No response generated',
      actions_taken: [],
      correctedData: null,
      confidence: 0,
    };
  }
}
