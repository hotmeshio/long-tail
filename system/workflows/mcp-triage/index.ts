import { Durable } from '@hotmeshio/hotmesh';

import { TOOL_ROUNDS_TRIAGE } from '../../../modules/defaults';
import type { LTEnvelope, LTReturn } from '../../../types';
import * as activities from '../../activities/triage';
import * as interceptorActivities from '../../../services/interceptor/activities';
import { TRIAGE_SYSTEM_PROMPT, TRIAGE_REENTRY_CONTEXT, TRIAGE_EXHAUSTED_ROUNDS } from './prompts';

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
  );
}

// ── Response handling ───────────────────────────────────────────

async function handleFinalResponse(
  content: string,
  envelope: LTEnvelope,
  toolCallCount: number,
): Promise<LTReturn> {
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

    const correctedData = {
      ...escalationPayload,
      ...parsed.correctedData,
    };
    // Strip triage flags that the LLM may have echoed from context
    delete correctedData._lt;
    const directResolution = parsed.directResolution || false;
    const originalTaskId = envelope.data.originalTaskId;

    const triageMilestones = [
      { name: 'triage', value: 'completed' },
      { name: 'triage_method', value: toolCallCount > 0 ? 'llm_with_tools' : 'llm_direct' },
      { name: 'tool_calls', value: String(toolCallCount) },
    ];

    // ── Exit vortex: route corrected data back to the original workflow ──
    if (originalWorkflowType && originalTaskQueue && originalTaskId) {
      const originalTask = await ltGetTask(originalTaskId);
      const originalWfConfig = await ltGetWorkflowConfig(originalWorkflowType);

      // Reconstruct the original envelope from the task record
      let originalEnvelope: Record<string, any> = {};
      if (originalTask?.envelope) {
        try {
          originalEnvelope = JSON.parse(originalTask.envelope);
        } catch { /* use empty */ }
      }

      // Extract routing metadata — used by both resolution paths
      const originalMeta = originalTask?.metadata as Record<string, any> | null;

      // Enrich the envelope with full routing context so re-runs
      // find the original task instead of creating orphan tasks.
      originalEnvelope.lt = {
        ...originalEnvelope.lt,
        taskId: originalTaskId,
        originId,
        parentId: originalTask?.parent_id || originalEnvelope.lt?.parentId,
        signalId: originalMeta?.signalId,
        parentWorkflowId: originalMeta?.parentWorkflowId,
        parentTaskQueue: originalMeta?.parentTaskQueue,
        parentWorkflowType: originalMeta?.parentWorkflowType,
      };

      // Strip triage flags from the envelope so resolving this
      // follow-on escalation does NOT re-trigger mcpTriage.
      if (originalEnvelope.data?._lt) {
        delete originalEnvelope.data._lt;
      }

      // ── Direct resolution: simple approval/rejection/pass-through ──
      if (directResolution && correctedData) {
        originalEnvelope.resolver = correctedData;
        originalEnvelope.lt = {
          ...originalEnvelope.lt,
          escalationId: envelope.data.escalationId,
          _triageDirect: true,
        };

        const rerunWorkflowId = `triage-rerun-${originalTaskId}-${Durable.guid()}`;
        await ltStartWorkflow({
          workflowName: originalWorkflowType,
          taskQueue: originalTaskQueue,
          workflowId: rerunWorkflowId,
          args: [originalEnvelope],
          expire: 180,
        });

        return {
          type: 'return',
          data: {
            triaged: true,
            exitedVortex: true,
            directResolution: true,
            targetedOriginalTask: originalTaskId,
            hasCorrectedData: true,
            rerunWorkflowId,
            correctedData,
            originalWorkflowType,
            originalTaskQueue,
            originId,
            diagnosis: parsed.diagnosis,
            actions_taken: parsed.actions_taken,
            tool_calls_made: toolCallCount,
            confidence: parsed.confidence,
          },
          milestones: [
            ...triageMilestones,
            { name: 'vortex', value: 'direct_resolution' },
          ],
        };
      }

      // ── Escalation path: tool-assisted fix or triage failure ──
      const escalationPayloadForOriginal: Record<string, any> = correctedData
        ? {
            ...correctedData,
            _triage: {
              diagnosis: parsed.diagnosis,
              actions_taken: parsed.actions_taken,
              tool_calls_made: toolCallCount,
              confidence: parsed.confidence,
              recommendation: parsed.recommendation,
              originalData: envelope.data.escalationPayload || {},
            },
          }
        : {
            ...(envelope.data.escalationPayload || {}),
            _triage: {
              diagnosis: parsed.diagnosis,
              actions_taken: parsed.actions_taken,
              tool_calls_made: toolCallCount,
              confidence: parsed.confidence,
              recommendation: parsed.recommendation,
            },
          };

      const description = correctedData
        ? `AI Triage — Ready for Review`
        : `AI Triage — Needs Attention`;

      await ltCreateEscalation({
        type: originalWorkflowType,
        subtype: originalWorkflowType,
        modality: originalWfConfig?.modality || 'default',
        description,
        priority: correctedData ? 3 : 2,
        taskId: originalTaskId,
        originId,
        parentId: envelope.lt?.parentId,
        role: correctedData
          ? (originalWfConfig?.role || 'reviewer')
          : 'engineer',
        envelope: JSON.stringify(originalEnvelope),
        escalationPayload: JSON.stringify(escalationPayloadForOriginal),
        workflowId: originalTask?.workflow_id,
        workflowType: originalWorkflowType,
        taskQueue: originalTaskQueue,
      });
    }

    // Vortex complete — triage returns successfully.
    // The interceptor will complete the triage task but will NOT
    // signal the original parent (routing was stripped / self-referencing).
    return {
      type: 'return',
      data: {
        triaged: true,
        exitedVortex: true,
        directResolution: false,
        targetedOriginalTask: envelope.data.originalTaskId || null,
        hasCorrectedData: !!correctedData,
        correctedData,
        originalWorkflowType,
        originalTaskQueue,
        originId,
        diagnosis: parsed.diagnosis,
        actions_taken: parsed.actions_taken,
        tool_calls_made: toolCallCount,
        confidence: parsed.confidence,
      },
      milestones: [
        ...triageMilestones,
        { name: 'vortex', value: 'unwound' },
      ],
    };
  }

  // LLM couldn't fix — return with failure info so the parent router
  // gets signaled. The router or calling code handles escalation creation.
  // (Returning { type: 'escalation' } would create an escalation via the
  // interceptor but would NOT signal the parent, leaving it hanging.)
  return {
    type: 'return',
    data: {
      triaged: true,
      exitedVortex: false,
      hasCorrectedData: false,
      correctedData: null,
      originId,
      originalWorkflowType,
      originalTaskQueue,
      originalTaskId: envelope.data.originalTaskId,
      diagnosis: parsed.diagnosis || 'AI triage could not determine a fix',
      actions_taken: parsed.actions_taken || [],
      tool_calls_made: toolCallCount,
      recommendation: parsed.recommendation || '',
      confidence: parsed.confidence || 0,
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_method', value: toolCallCount > 0 ? 'llm_with_tools' : 'llm_direct' },
      { name: 'tool_calls', value: String(toolCallCount) },
      { name: 'vortex', value: 'unresolved' },
    ],
  };
}

function stripJsonComments(text: string): string {
  return text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseTriageResponse(content: string): Record<string, any> {
  // Strip markdown fences if present
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  // Try to extract JSON from the response — the LLM might include extra text.
  // LLMs frequently produce JS-style comments in JSON; strip them before parsing.
  const noComments = stripJsonComments(cleaned);
  try {
    return JSON.parse(noComments);
  } catch {
    // Try to find a JSON object embedded in the text
    const jsonMatch = noComments.match(/\{[\s\S]*\}/);
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
