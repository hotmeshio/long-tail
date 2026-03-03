import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope, LTReturn, LTEscalation } from '../../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  getUpstreamTasks,
  getEscalationHistory,
  listDocumentPages,
  rotatePage,
  translateContent,
  notifyEngineering,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * MCP Triage workflow (leaf).
 *
 * Activated when a human resolver gives up and flags `needsTriage` in their
 * resolution payload. This is the MCP remediation escape hatch — it uses
 * MCP tools to figure out what went wrong and produce corrected data.
 *
 * The triage leaf does NOT re-invoke the original workflow. It returns
 * `correctedData` to the orchestrator, which handles the re-invocation.
 * This keeps the leaf pure — it can escalate to an engineer for guidance
 * using the standard LT escalation mechanism.
 *
 * **First entry** (no `envelope.resolver`):
 *
 * 1. Queries upstream tasks and escalation history for full context
 * 2. For known hints (wrong_language, image_orientation): applies the fix
 *    via MCP tools and returns `{ correctedData }` to the orchestrator
 * 3. For unknown/complex issues: escalates to `engineer` with full context.
 *    The workflow ENDS — the interceptor creates an escalation record.
 *
 * **Re-entry** (has `envelope.resolver` — engineer responded):
 *
 * 1. Reads the engineer's guidance from `envelope.resolver`
 * 2. Applies the guided fix via MCP tools
 * 3. Returns `{ correctedData }` to the orchestrator
 *
 * The orchestrator receives the corrected data and re-invokes the original
 * workflow. When it succeeds, the container interceptor signals back to
 * the original parent, completing the vortex.
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

  // ── Re-entry: engineer (or another role) responded to our escalation ──
  if (envelope.resolver) {
    return handleEngineerResponse(envelope);
  }

  // ── First entry: analyze the situation and decide what to do ───────────

  // 1. Query all upstream tasks and escalation history for full context
  const upstreamTasks = await getUpstreamTasks(originId);
  const escalationHistory = await getEscalationHistory(originId);

  // 2. Determine remediation from resolver hints
  const hint = (resolverPayload?._lt?.hint ?? '').toString().toLowerCase();

  // 3. Known hints — apply automatic fix via MCP tools
  if (hint.includes('image_orientation') || hint.includes('orientation') || hint.includes('rotate')) {
    return handleImageOrientation(envelope, upstreamTasks.length);
  }

  if (hint.includes('wrong_language') || hint.includes('language') || hint.includes('translate')) {
    return handleWrongLanguage(envelope, upstreamTasks.length);
  }

  // 4. Unknown/complex issue — escalate to engineer with full context
  //    The workflow ENDS here. When the engineer resolves, the interceptor
  //    re-runs this workflow with envelope.resolver populated.
  return {
    type: 'escalation',
    data: {
      originId,
      originalWorkflowType,
      originalTaskQueue,
      escalationPayload,
      resolverPayload,
      context: {
        upstreamTaskCount: upstreamTasks.length,
        upstreamTasks: upstreamTasks.map(t => ({
          id: t.id,
          workflow_type: t.workflow_type,
          status: t.status,
          created_at: t.created_at,
        })),
        escalationHistory: escalationHistory.map(e => ({
          id: e.id,
          type: e.type,
          role: e.role,
          status: e.status,
          description: e.description,
          created_at: e.created_at,
        })),
        humanComments: resolverPayload,
      },
    },
    message:
      `Triage needed for ${originalWorkflowType} (origin: ${originId}). ` +
      `${upstreamTasks.length} upstream task(s), ${escalationHistory.length} prior escalation(s). ` +
      `Human comment: ${resolverPayload?.reason || resolverPayload?.notes || 'no details provided'}. ` +
      `Please review the context and provide guidance: what fix should be applied?`,
    role: 'engineer',
    priority: 2,
  };
}

// ── Handlers ──────────────────────────────────────────────────────────────

/**
 * Handle re-entry after an engineer responds to the triage escalation.
 *
 * The engineer's response is in `envelope.resolver`. It may contain:
 * - `action`: what to do ('translate', 'rotate', 'correct_data', 'retry')
 * - `hint`: a hint for the automatic handler
 * - `correctedData`: direct data to use for re-invocation
 * - `notes`: context for the audit trail
 *
 * Returns `{ correctedData }` so the orchestrator can re-invoke.
 */
async function handleEngineerResponse(
  envelope: LTEnvelope,
): Promise<LTReturn> {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    escalationPayload,
  } = envelope.data;

  const resolver = envelope.resolver as Record<string, any>;
  const rawAction = (resolver.action || resolver._lt?.hint || resolver.hint || '').toString().toLowerCase();
  let correctedData: Record<string, any>;

  if (rawAction.includes('wrong_language') || rawAction.includes('language') || rawAction.includes('translate')) {
    const content = escalationPayload?.content || '';
    const targetLang = resolver.targetLanguage || 'en';
    const translation = await translateContent(content, targetLang);
    correctedData = {
      ...escalationPayload,
      content: translation.translated_content,
    };

    await notifyEngineering(
      originId,
      `Content arrived in ${translation.source_language} — translated per engineer guidance. ` +
      `Recommend adding language detection to the pipeline.`,
      { action: rawAction, source_language: translation.source_language },
    );
  } else if (rawAction.includes('image_orientation') || rawAction.includes('orientation') || rawAction.includes('rotate')) {
    const pages = escalationPayload?.documents || await listDocumentPages();
    const degrees = resolver.degrees || 180;
    const rotatedPages: string[] = [];
    for (const page of pages) {
      rotatedPages.push(await rotatePage(page, degrees));
    }
    correctedData = {
      ...escalationPayload,
      documents: rotatedPages,
    };
  } else if (resolver.correctedData) {
    correctedData = resolver.correctedData;
  } else {
    // General guidance — pass through with engineer's response augmented
    correctedData = {
      ...escalationPayload,
      _engineerGuidance: resolver,
    };
  }

  return {
    type: 'return',
    data: {
      correctedData,
      originalWorkflowType,
      originalTaskQueue,
      originId,
      resolvedVia: 'engineer_guidance',
      engineerAction: rawAction || 'custom',
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_resolved_via', value: 'engineer_guidance' },
    ],
  };
}

/**
 * Automatic fix: rotate upside-down document pages.
 * Returns corrected data for the orchestrator to re-invoke with.
 */
async function handleImageOrientation(
  envelope: LTEnvelope,
  upstreamTaskCount: number,
): Promise<LTReturn> {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    escalationPayload,
  } = envelope.data;

  // Use documents from escalation payload if available, else query MCP
  const pages = escalationPayload?.documents || await listDocumentPages();
  const rotatedPages: string[] = [];
  for (const page of pages) {
    rotatedPages.push(await rotatePage(page, 180));
  }

  return {
    type: 'return',
    data: {
      correctedData: {
        ...escalationPayload,
        documents: rotatedPages,
      },
      originalWorkflowType,
      originalTaskQueue,
      originId,
      hint: 'image_orientation',
      upstreamTaskCount,
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_hint', value: 'image_orientation' },
    ],
  };
}

/**
 * Automatic fix: translate wrong-language content.
 * Returns corrected data for the orchestrator to re-invoke with.
 */
async function handleWrongLanguage(
  envelope: LTEnvelope,
  upstreamTaskCount: number,
): Promise<LTReturn> {
  const {
    originId,
    originalWorkflowType,
    originalTaskQueue,
    escalationPayload,
  } = envelope.data;

  const originalContent = escalationPayload?.content || '';
  const translation = await translateContent(originalContent, 'en');

  // Non-blocking recommendation to engineering
  await notifyEngineering(
    originId,
    `Content arrived in ${translation.source_language} — translated and re-processed successfully. ` +
    `Recommend adding a language detection step to the pipeline to handle this automatically.`,
    { hint: 'wrong_language', source_language: translation.source_language },
  );

  return {
    type: 'return',
    data: {
      correctedData: {
        ...escalationPayload,
        content: translation.translated_content,
      },
      originalWorkflowType,
      originalTaskQueue,
      originId,
      hint: 'wrong_language',
      upstreamTaskCount,
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_hint', value: 'wrong_language' },
    ],
  };
}
