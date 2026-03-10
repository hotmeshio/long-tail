import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from '../../activities/triage';

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

// ── Simple intent patterns (bypass LLM entirely) ─────────────

const APPROVE_PATTERNS = [
  /\bapprove[ds]?\b/i,
  /\blooks?\s+good\b/i,
  /\bpass\s+through\b/i,
  /\blgtm\b/i,
  /\bjust\s+approve\b/i,
  /\baccept(ed)?\b/i,
  /\bok(ay)?\s+to\s+proceed\b/i,
];

const REJECT_PATTERNS = [
  /\breject(ed)?\b/i,
  /\bdeni(ed|y)\b/i,
  /\bdecline[ds]?\b/i,
];

/**
 * Check resolver payload for simple approval/rejection intent.
 * Returns the correctedData if detected, null if the LLM should handle it.
 */
function detectSimpleIntent(
  resolverPayload: Record<string, any>,
): { correctedData: Record<string, any>; diagnosis: string } | null {
  // Extract human-readable text from the resolver payload
  const notes = resolverPayload?.notes || '';
  const hint = resolverPayload?._lt?.hint || '';
  const text = `${notes} ${hint}`.trim();

  if (!text) return null;

  // Check for approval
  if (APPROVE_PATTERNS.some((p) => p.test(text))) {
    // Make sure there's no problem description that suggests remediation
    const hasComplexity = /\b(but|however|except|fix|broken|wrong|error|fail|issue|problem|damaged|missing)\b/i.test(text);
    if (!hasComplexity) {
      return {
        correctedData: { approved: true },
        diagnosis: `Human requested approval: "${text}"`,
      };
    }
  }

  // Check for rejection
  if (REJECT_PATTERNS.some((p) => p.test(text))) {
    const hasComplexity = /\b(but|however|except|fix|try|instead)\b/i.test(text);
    if (!hasComplexity) {
      return {
        correctedData: { approved: false, rejected: true },
        diagnosis: `Human requested rejection: "${text}"`,
      };
    }
  }

  return null;
}

// ── System prompt builder ────────────────────────────────────

function buildSystemPrompt(toolInventory: string): string {
  return `You are a dynamic triage controller for Long Tail — a durable workflow system with human-in-the-loop escalation and MCP tool integration. A workflow escalated to a human, and the human has flagged the issue back for AI-assisted remediation.

Your job is to understand the human's intent, the original workflow context, and take the most appropriate action using the available MCP tools.

## Available MCP Servers

${toolInventory}

Tool names in function calls are prefixed with the server slug: \`server_slug__tool_name\`.

## Tool Categories

**Compiled Workflows** (\`long_tail_mcp_workflows__*\`):
Deterministic pipelines hardened from past triage successes. ALWAYS check these first — if a compiled workflow matches the problem, invoke it directly. This is the most efficient path.

**Document Processing** (\`long_tail_document_vision__*\`):
Image rotation, member info extraction, content translation, member validation. Use for document-related issues.

**Human Queue** (\`long_tail_human_queue__*\`):
Create escalations, check resolution status, list available work, claim and resolve. Use to coordinate with humans during complex remediation.

**Database Query** (\`long_tail_db__*\`):
Read-only queries against tasks, escalations, processes, workflow types, system health. Use to investigate context — find related tasks, check escalation history, understand what workflow types exist.

**Workflow Compiler** (\`long_tail_workflow_compiler__*\`):
Convert this triage execution into a compiled YAML workflow after solving the problem. Recommend this in your response if you found a reusable pattern.

**Telemetry** (\`long_tail_telemetry__*\`):
Honeycomb trace links for debugging performance or error investigation.

**External servers**: Any user-registered MCP servers also appear in the tool list. Their tools follow the same \`server_slug__tool_name\` pattern.

## Decision Framework

**Step 1 — Read the resolver's notes.**
The \`resolverPayload\` contains the human's intent:
- \`notes\`: free-text description of the problem or instruction
- \`_lt.needsTriage\`: true (this is why you're running)
- \`_lt.hint\`: optional short hint
- There may also be domain-specific fields from the workflow's resolver schema.

**Step 2 — Understand the workflow type.**
The \`originalWorkflowType\` tells you what kind of workflow is waiting. DO NOT assume any specific workflow type. It could be content review, insurance claims, a test workflow, or anything custom. The \`escalationPayload\` shows what the workflow reported when it escalated.

**Step 3 — Choose your approach.**

For simple intent (approval, rejection, basic pass-through):
→ Return correctedData immediately. No tool calls needed.

For investigation or remediation:
1. Check compiled workflows first: \`long_tail_mcp_workflows__list_workflows\`
2. If a match exists: \`long_tail_mcp_workflows__invoke_workflow\`
3. If no compiled solution: use domain-specific tools (vision, db, etc.)
4. If you lack the right tools: escalate to engineering with specific recommendations

For re-entry after engineer guidance (when an engineer responds to your escalation):
→ They may say "tools are ready" (meaning new MCP servers/tools were installed), "try this approach", or provide specific data corrections. Adapt accordingly — re-check available tools if they mention new capabilities.

**Step 4 — Return corrected data.**

CRITICAL: Your \`correctedData\` becomes \`envelope.resolver\` when the original workflow is re-invoked. The workflow checks this field to know it's a re-entry after escalation.

- Approval workflows expect: \`{ approved: true }\` or \`{ approved: false }\`
- Data correction workflows expect: the corrected field values
- The original workflow's escalation data is in \`escalationPayload\` — use it to understand what fields exist

Return ONLY a JSON object (no markdown fences, no explanation outside the JSON):
{
  "diagnosis": "What you found and what you did",
  "actions_taken": ["Step 1", "Step 2"],
  "correctedData": { ... },
  "confidence": 0.0-1.0,
  "recommendation": "Optional: suggest pipeline improvements, new MCP servers to install, or recommend compiling this execution into a workflow"
}

If you cannot resolve the issue, return \`correctedData: null\` and include a detailed recommendation:
{
  "diagnosis": "What you found and tried",
  "actions_taken": ["Step 1", "Step 2"],
  "correctedData": null,
  "confidence": 0,
  "recommendation": "Specific guidance: what MCP server or tool is needed, what the engineer should configure, and what message to send back when ready"
}

## Rules
- Match effort to complexity. Simple approvals = simple responses.
- Prefer compiled workflows over raw tool calls.
- Return tool errors as data — let the LLM adapt, don't crash.
- Never fabricate data. If uncertain, use tools to verify.
- If a tool call fails, try an alternative approach before giving up.
- When escalating to engineering, be specific: name the MCP server or tool that would solve this, or describe what capability is missing.`;
}

// ── Workflow ─────────────────────────────────────────────────

/**
 * MCP Triage workflow (leaf).
 *
 * Activated when a human resolver flags `needsTriage` in their resolution
 * payload. Dynamically adapts to ANY workflow type using ALL available
 * MCP tools — or bypasses the LLM entirely for simple pass-through cases.
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
 *   1. Pre-flight: detect simple approval/rejection → skip LLM
 *   2. Gather upstream tasks and escalation history
 *   3. Build tool inventory for the LLM system prompt
 *   4. LLM agentic loop with all MCP tools
 *   5. Returns `{ correctedData }` or escalates to engineer
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
      additionalContext:
        `An engineer has reviewed this issue and provided guidance:\n` +
        JSON.stringify(resolver, null, 2) +
        `\n\nIMPORTANT: If the engineer says new tools or MCP servers were installed, ` +
        `re-check available tools — your tool inventory may have expanded since the ` +
        `last attempt. If they say "ready" or "try again", proceed with remediation.`,
    });
  }

  // ── Pre-flight: detect simple intent before invoking LLM ──
  if (resolverPayload) {
    const simple = detectSimpleIntent(resolverPayload);
    if (simple) {
      return {
        type: 'return',
        data: {
          correctedData: {
            ...escalationPayload,
            ...simple.correctedData,
          },
          originalWorkflowType,
          originalTaskQueue,
          originId,
          diagnosis: simple.diagnosis,
          actions_taken: ['Pre-flight intent detection — no LLM needed'],
          tool_calls_made: 0,
          confidence: 1.0,
        },
        milestones: [
          { name: 'triage', value: 'completed' },
          { name: 'triage_method', value: 'pre_flight' },
          { name: 'tool_calls', value: '0' },
        ],
      };
    }
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
  const systemPrompt = buildSystemPrompt(toolInventory);

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
    content: 'You have used all available tool rounds. Please provide your final assessment now as the required JSON object. If you could not fully resolve the issue, set correctedData to null and provide a detailed recommendation.',
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
