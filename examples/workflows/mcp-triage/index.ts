import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  getUpstreamTasks,
  getEscalationHistory,
  getVisionTools,
  callVisionTool,
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

const MAX_TOOL_ROUNDS = 8;

const SYSTEM_PROMPT = `You are an automated triage specialist for a document processing system. A workflow failed and a human reviewer has flagged the issue for AI-assisted remediation.

Your job:
1. Diagnose why the original workflow failed using the failure context provided
2. Use the available document processing tools to investigate and fix the issue
3. Return corrected data so the original workflow can be re-run successfully

Diagnostic strategy:
1. Start by listing document pages (list_document_pages) to see what's available
2. Common issues and their fixes:
   - **Unreadable/damaged/upside-down images**: Rotate pages with rotate_page (try 180 degrees first). After rotating, use extract_member_info on the rotated reference to verify the fix worked.
   - **Wrong language content**: Use translate_content to convert to the target language (usually English)
   - **Extraction failures**: Try extracting from different pages, or rotate and retry
   - **Validation mismatches**: Use validate_member to check extracted data against the database
3. After applying fixes, verify the result by extracting/validating the corrected data
4. Build the corrected data object for re-invocation of the original workflow

IMPORTANT rules:
- Always call at least one tool — never guess at what's wrong
- When rotating pages, use the RETURNED rotated_ref from rotate_page as the new image reference
- After rotating, call extract_member_info with the rotated reference to confirm the fix worked
- The corrected data must include all fields the original workflow needs

When done, return ONLY a JSON object (no markdown fences):
{
  "diagnosis": "Clear description of what went wrong",
  "actions_taken": ["Step 1: ...", "Step 2: ...", ...],
  "correctedData": {
    ...all fields the original workflow needs, with problematic fields corrected...
    "documents": ["page1_upside_down_rotated.png", "page2.png"] // corrected document list for re-invocation
  },
  "confidence": 0.0-1.0,
  "recommendation": "Suggested pipeline improvement to prevent this in future"
}

If you cannot fix the issue after investigation, return:
{
  "diagnosis": "What you found",
  "actions_taken": ["What you tried"],
  "correctedData": null,
  "confidence": 0,
  "recommendation": "What a human engineer should investigate"
}`;

/**
 * MCP Triage workflow (leaf).
 *
 * Activated when a human resolver flags \`needsTriage\` in their resolution
 * payload. Uses an LLM-driven agentic loop with Vision MCP tools to
 * diagnose and fix document processing failures.
 *
 * The LLM dynamically decides which tools to call — rotate pages, extract
 * member info, translate content, validate against the database — creating
 * a rich event history of tool calls. This event history can later be
 * converted to a deterministic MCP pipeline (same as insight workflows).
 *
 * **First entry** (no \`envelope.resolver\`):
 *   1. Queries upstream tasks and escalation history for full context
 *   2. Gives the LLM all available Vision MCP tools
 *   3. LLM diagnoses the issue and applies fixes via tool calls
 *   4. Returns \`{ correctedData }\` to the orchestrator
 *   5. If LLM can't fix it, escalates to engineer with full diagnosis
 *
 * **Re-entry** (has \`envelope.resolver\` — engineer responded):
 *   1. Adds engineer's guidance to the LLM context
 *   2. LLM uses the guidance + tools to apply the fix
 *   3. Returns \`{ correctedData }\` to the orchestrator
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
        JSON.stringify(resolver, null, 2),
    });
  }

  // ── First entry: gather context and let LLM diagnose + fix ──
  const upstreamTasks = await getUpstreamTasks(originId);
  const escalationHistory = await getEscalationHistory(originId);

  const contextParts = [
    `**Original Workflow**: ${originalWorkflowType} (queue: ${originalTaskQueue})`,
    `**Origin ID**: ${originId}`,
    `**Failure Data**:\n${JSON.stringify(escalationPayload, null, 2)}`,
    `**Reviewer Notes**:\n${JSON.stringify(resolverPayload, null, 2)}`,
  ];

  if (upstreamTasks.length > 0) {
    contextParts.push(
      `**Upstream Tasks** (${upstreamTasks.length}):\n${JSON.stringify(
        upstreamTasks.map((t) => ({
          id: t.id,
          type: t.workflow_type,
          status: t.status,
        })),
        null,
        2,
      )}`,
    );
  }

  if (escalationHistory.length > 0) {
    contextParts.push(
      `**Escalation History** (${escalationHistory.length}):\n${JSON.stringify(
        escalationHistory.map((e) => ({
          id: e.id,
          type: e.type,
          role: e.role,
          status: e.status,
          description: e.description,
        })),
        null,
        2,
      )}`,
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
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    escalationPayload,
  } = envelope.data;

  const tools = await getVisionTools();
  const messages: any[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Please diagnose and fix this issue:\n\n${opts.additionalContext}`,
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

      const result = await callVisionTool(toolCall.function.name, args);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  // Exhausted rounds — ask for final synthesis without tools
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
        { name: 'triage_method', value: 'llm_assisted' },
        { name: 'tool_calls', value: String(toolCallCount) },
      ],
    };
  }

  // LLM couldn't fix — escalate to engineer with full diagnosis
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
    },
    message:
      `AI triage could not resolve the issue for ${originalWorkflowType} ` +
      `(origin: ${originId}). Diagnosis: ${parsed.diagnosis || 'unknown'}. ` +
      `${toolCallCount} tool call(s) made. Please review and provide guidance.`,
    role: 'engineer',
    priority: 2,
  };
}

function parseTriageResponse(content: string): Record<string, any> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return {
      diagnosis: cleaned || 'No response generated',
      actions_taken: [],
      correctedData: null,
      confidence: 0,
    };
  }
}
