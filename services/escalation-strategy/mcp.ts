import type {
  LTEscalationStrategy,
  ResolutionContext,
  ResolutionDirective,
} from '../../types/escalation-strategy';

/**
 * MCP escalation strategy.
 *
 * Checks for `resolverPayload._lt.needsTriage`. When set, builds a
 * triage envelope and returns `{ action: 'triage' }` so the resolution
 * route starts the mcpTriage workflow instead of a standard re-run.
 *
 * When `needsTriage` is not set, falls through to standard `{ action: 'rerun' }`.
 */
export class McpEscalationStrategy implements LTEscalationStrategy {
  async onResolution(context: ResolutionContext): Promise<ResolutionDirective> {
    const { escalation, resolverPayload, envelope } = context;

    if (!resolverPayload?._lt?.needsTriage) {
      return { action: 'rerun' };
    }

    // Parse escalation payload safely
    let escalationPayload: Record<string, any> = {};
    if (escalation.escalation_payload) {
      try {
        escalationPayload = JSON.parse(escalation.escalation_payload);
      } catch { /* use empty */ }
    }

    // Strip routing fields from the original envelope's `lt` — triage
    // runs on a separate axis and must NOT signal the original parent.
    // Keep only originId and parentId which the triage workflow uses.
    const originalLt = envelope.lt || {};
    const triageEnvelope = {
      data: {
        escalationId: escalation.id,
        originId: escalation.origin_id,
        originalWorkflowType: escalation.workflow_type,
        originalTaskQueue: escalation.task_queue,
        originalTaskId: escalation.task_id,
        escalationPayload,
        resolverPayload,
      },
      metadata: envelope.metadata || {},
      lt: {
        originId: originalLt.originId,
        parentId: originalLt.parentId,
      },
    };

    return { action: 'triage', triageEnvelope };
  }
}
