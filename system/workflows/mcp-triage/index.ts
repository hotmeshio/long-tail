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

// ── System prompt builder ────────────────────────────────────

function buildSystemPrompt(toolInventory: string): string {
  return `You are a dynamic triage controller for Long Tail — a durable workflow system with human-in-the-loop escalation and MCP tool integration. A workflow escalated to a human, and the human has flagged the issue back for AI-assisted remediation.

Your job is to understand the human's intent, the original workflow context, and use MCP tools to fix the problem. When you have the answer, return it as \`correctedData\`.

## The Triage Vortex

You operate inside a **triage vortex** — a separate dimension from the original workflow. The original workflow is paused, waiting. You can take as many steps as needed within this vortex: call tools, create escalations to engineers, wait for guidance, retry. But the moment you have the corrected data, you exit the vortex by returning it. The orchestrator then creates a final escalation targeting the original task with your polished answer.

**Your output IS the delivery mechanism.** When you return \`correctedData\`, the orchestrator:
1. Creates an escalation on the original task with your corrected data as the primary payload
2. A human reviews and resolves that escalation
3. The original workflow re-runs with the fix applied

You do NOT need to submit, POST, deliver, or resolve anything yourself. Just produce the corrected data and return it.

## Available MCP Servers

${toolInventory}

Tool names in function calls are prefixed with the server slug: \`server_slug__tool_name\`.

## Tool Categories

**Compiled Workflows** (\`long_tail_mcp_workflows__*\`):
Deterministic pipelines hardened from past triage successes. ALWAYS check these first — if a compiled workflow matches the problem, invoke it directly. This is the most efficient path.

**Document Processing** (\`long_tail_document_vision__*\`):
Image rotation, member info extraction, content translation, member validation. Use for document-related issues.

**Human Queue** (\`long_tail_human_queue__*\`):
Create escalations within the triage vortex when you need human help (e.g., asking an engineer to install tools). Note: you can also escalate simply by returning \`correctedData: null\` — the orchestrator will create an engineer escalation automatically. Using human-queue tools gives you more control over routing but is usually unnecessary.

**Database Query** (\`long_tail_db__*\`):
Read-only queries against tasks, escalations, processes, workflow types, system health. Use to investigate context.

**Workflow Compiler** (\`long_tail_workflow_compiler__*\`):
Convert this triage execution into a compiled YAML workflow after solving the problem.

**HTTP Fetch** (\`long_tail_http_fetch__*\`):
Fetch external data needed during investigation. Not for delivering results — your JSON response handles that.

**Telemetry** (\`long_tail_telemetry__*\`):
Honeycomb trace links for debugging.

**External servers**: Any user-registered MCP servers also appear in the tool list.

## Decision Framework

**Step 1 — Read the resolver's notes.**
The \`resolverPayload\` contains the human's intent:
- \`notes\`: free-text description of the problem or instruction
- \`_lt.needsTriage\`: true (this is why you're running)
- \`_lt.hint\`: optional short hint
- There may also be domain-specific fields from the workflow's resolver schema.

**Step 2 — Understand the workflow type.**
The \`originalWorkflowType\` tells you what kind of workflow is waiting. DO NOT assume any specific workflow type. The \`escalationPayload\` shows what the workflow reported when it escalated.

**Step 3 — Choose your approach.**

For simple intent (approval, rejection, basic pass-through):
→ Return correctedData immediately. No tool calls needed.

For investigation or remediation:
1. Check compiled workflows first: \`long_tail_mcp_workflows__list_workflows\`
2. If a match exists: \`long_tail_mcp_workflows__invoke_workflow\`
3. If no compiled solution: use domain-specific tools (vision, db, etc.)
4. If you lack the right tools: return \`correctedData: null\` with a recommendation — the orchestrator will escalate to engineering

For re-entry after engineer guidance (when an engineer responds to your escalation):
→ They may say "tools are ready" or provide specific guidance. Re-check available tools and proceed.

**Step 4 — Return corrected data.**

CRITICAL: Your \`correctedData\` becomes \`envelope.resolver\` when the original workflow is re-invoked.

- Approval workflows expect: \`{ approved: true }\` or \`{ approved: false }\`
- Data correction workflows expect: the corrected field values that REPLACE the originals
- The original workflow's escalation data is in \`escalationPayload\` — use it to understand what fields exist
- Put the CORRECTED version in the SAME field name as the original. For example, if \`escalationPayload.content\` was in Spanish, set \`correctedData.content\` to the English translation — do NOT create a new \`translatedContent\` field. The correctedData should be a drop-in replacement.
- When tools return references (e.g., \`rotated_ref\` from \`rotate_page\`), use the EXACT reference returned — do NOT invent filenames. The \`rotate_page\` tool handles cleanup of the original file automatically.

Return ONLY a JSON object (no markdown fences, no explanation outside the JSON):
{
  "diagnosis": "What you found and what you did",
  "actions_taken": ["Step 1", "Step 2"],
  "correctedData": { ... the corrected fields for the original workflow ... },
  "confidence": 0.0-1.0,
  "recommendation": "Optional: suggest pipeline improvements or recommend compiling this into a workflow"
}

If you performed useful work but want a human to review before it goes back to the original workflow, STILL return the correctedData and set \`needsHumanReview: true\`:
{
  "diagnosis": "What you found and did",
  "actions_taken": ["Step 1", "Step 2"],
  "correctedData": { ... your results ... },
  "needsHumanReview": true,
  "confidence": 0.7,
  "recommendation": "Translation completed — human should verify quality before approval"
}

Only return \`correctedData: null\` when you truly could NOT produce any useful output:
{
  "diagnosis": "What you found and tried",
  "actions_taken": ["Step 1", "Step 2"],
  "correctedData": null,
  "confidence": 0,
  "recommendation": "Specific guidance: what tool or capability is needed"
}

## Rules
- Match effort to complexity. Simple approvals = simple responses.
- Prefer compiled workflows over raw tool calls.
- Return tool errors as data — adapt, don't crash.
- Never fabricate data. If uncertain, use tools to verify.
- If a tool call fails, try an alternative approach before giving up.
- **If you successfully produced corrected data (e.g., translated content, rotated image), ALWAYS include it in \`correctedData\` — even if an unrelated step failed afterward.** Do not discard good work.
- Do NOT use \`claim_and_resolve\` or \`resolve_escalation\` on the ORIGINAL escalation — the orchestrator handles that when you return correctedData.
- Do NOT use HTTP tools to "submit" or "deliver" results. Your JSON response IS the delivery.`;
}

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
      additionalContext:
        `An engineer has reviewed this issue and provided guidance:\n` +
        JSON.stringify(resolver, null, 2) +
        `\n\nIMPORTANT: If the engineer says new tools or MCP servers were installed, ` +
        `re-check available tools — your tool inventory may have expanded since the ` +
        `last attempt. If they say "ready" or "try again", proceed with remediation.`,
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
