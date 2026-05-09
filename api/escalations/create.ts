import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { publishEscalationEvent } from '../../lib/events/publish';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// ── Create ────────────────────────────────────────────────────────────────

/**
 * Create a standalone escalation (not tied to a workflow).
 *
 * Useful for manual work items, support tickets, or approval requests
 * that originate outside the durable workflow engine. The caller must
 * hold the target role or be a superadmin.
 *
 * @param input.type — escalation category (e.g. `"support"`, `"approval"`)
 * @param input.subtype — subcategory for finer routing
 * @param input.role — role responsible for resolving this escalation
 * @param input.description — human-readable summary
 * @param input.priority — 1 (critical) through 4 (low), default 2
 * @param input.envelope — serialized context for the resolver
 * @param input.metadata — arbitrary key-value data (e.g. signal_routing)
 * @param input.escalation_payload — serialized payload for the resolver UI
 * @param auth — authenticated user context (must hold target role or be superadmin)
 * @returns `{ status: 201, data: <escalation record> }`
 */
export async function createEscalation(
  input: {
    type: string;
    subtype?: string;
    role: string;
    description?: string;
    priority?: number;
    envelope?: string;
    metadata?: Record<string, any>;
    escalation_payload?: string;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { type, role } = input;
    if (!type || typeof type !== 'string') {
      return { status: 400, error: 'type is required' };
    }
    if (!role || typeof role !== 'string') {
      return { status: 400, error: 'role is required' };
    }

    // RBAC: caller must hold the target role or be superadmin
    const isSuperAdminUser = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdminUser) {
      const userHasRole = await userService.hasRole(auth.userId, role);
      if (!userHasRole) {
        return { status: 403, error: `You must hold the "${role}" role or be a superadmin to create escalations for it` };
      }
    }

    const escalation = await escalationService.createEscalation({
      type,
      subtype: input.subtype ?? type,
      description: input.description,
      priority: input.priority,
      role,
      envelope: input.envelope ?? '{}',
      metadata: input.metadata,
      escalation_payload: input.escalation_payload,
    });

    publishEscalationEvent({
      type: 'escalation.created',
      source: 'api',
      workflowId: '',
      workflowName: '',
      taskQueue: '',
      escalationId: escalation.id,
      status: 'pending',
      data: { type: input.type, role },
    });

    return { status: 201, data: escalation };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
