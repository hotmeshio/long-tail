import { Durable } from '@hotmeshio/hotmesh';

import { executeLT } from '../../orchestrator';
import type { LTEnvelope, LTReturn } from '../../types';
import * as activities from './activities';

type ActivitiesType = typeof activities;

const {
  getUpstreamTasks,
  listDocumentPages,
  rotatePage,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * MCP Triage workflow.
 *
 * Activated when a resolver flags `needsTriage` in their resolution payload.
 * The triage workflow:
 *
 * 1. Queries all upstream tasks sharing the originId — full execution context
 * 2. Reads the resolver's hints to determine what remediation is needed
 * 3. Calls MCP tools to apply the fix (e.g., rotate an upside-down page)
 * 4. Re-invokes the original workflow with corrected inputs via executeLT
 * 5. Returns the result — the container interceptor signals the original parent
 *
 * The deterministic pipeline doesn't change. This workflow is the escape hatch
 * for when the deterministic path hits something it wasn't designed for.
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

  // 1. Query all upstream tasks for full context
  const upstreamTasks = await getUpstreamTasks(originId);

  // 2. Determine remediation from resolver hints
  const hint = resolverPayload?._lt?.hint;
  let correctedData: Record<string, any> = { ...escalationPayload };

  if (hint === 'image_orientation') {
    // 3. Get page list and rotate each page via MCP tool
    const pages = await listDocumentPages();
    const rotatedPages: string[] = [];
    for (const page of pages) {
      const rotated = await rotatePage(page, 180);
      rotatedPages.push(rotated);
    }
    correctedData.pages = rotatedPages;
  }

  // 4. Re-invoke the original workflow with corrected data
  const result = await executeLT({
    workflowName: originalWorkflowType,
    args: [{
      data: {
        documentId: correctedData.documentId,
        pages: correctedData.pages,
      },
      metadata: envelope.metadata || {},
    }],
    taskQueue: originalTaskQueue,
    originId,
  });

  // 5. Return with triage milestones — container interceptor signals parent
  return {
    type: 'return',
    data: {
      ...(result as any)?.data,
      triaged: true,
      hint,
      upstreamTaskCount: upstreamTasks.length,
    },
    milestones: [
      { name: 'triage', value: 'completed' },
      { name: 'triage_hint', value: hint || 'none' },
      ...((result as any)?.milestones || []),
    ],
  };
}
