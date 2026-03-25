import { loggerRegistry } from '../../../services/logger';
import { ltConfig } from '../../../modules/ltconfig';
import * as taskService from '../../../services/task';
import * as escalationService from '../../../services/escalation';
import type { LTTaskRecord, LTEscalationRecord } from '../../../types';

// ── Context activities ────────────────────────────────────────

/**
 * Query all tasks sharing an originId.
 * Gives the triage workflow full context of upstream work.
 */
export async function getUpstreamTasks(
  originId: string,
): Promise<LTTaskRecord[]> {
  const { tasks } = await taskService.listTasks({
    origin_id: originId,
    limit: 100,
  });
  return tasks;
}

/**
 * Query all escalations sharing an originId.
 * Gives the triage workflow the full conversation history.
 */
export async function getEscalationHistory(
  originId: string,
): Promise<LTEscalationRecord[]> {
  return escalationService.getEscalationsByOriginId(originId);
}

/**
 * Create an escalation to the engineering team with a recommendation.
 * Used by the triage workflow to surface long-term fixes (non-blocking).
 */
export async function notifyEngineering(
  originId: string,
  description: string,
  metadata?: Record<string, any>,
): Promise<void> {
  await escalationService.createEscalation({
    type: 'triage_recommendation',
    subtype: 'pipeline_fix',
    modality: 'async',
    description,
    priority: 3,
    origin_id: originId,
    role: 'engineer',
    envelope: JSON.stringify({}),
    metadata: {
      ...metadata,
      source: 'mcp_triage',
      auto_generated: true,
    },
  });
}

// ── Tool scoping ─────────────────────────────────────────────

/**
 * Look up tool_tags for a workflow type from lt_config_workflows (cached).
 * Returns empty array if the workflow type has no tags configured.
 */
export async function getToolTags(
  workflowType: string,
): Promise<string[]> {
  const tags = await ltConfig.getToolTags(workflowType);
  loggerRegistry.debug(`[mcpTriage:getToolTags] ${workflowType} → [${tags.join(',')}]`);
  return tags;
}
