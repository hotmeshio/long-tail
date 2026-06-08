import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';

import { hasGlobalEscalationAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

/**
 * Claim a pending escalation for the authenticated user.
 *
 * Sets `assigned_to` and `assigned_until` on the escalation (soft lock).
 * Non-superadmin users must hold the escalation's role. Publishes a
 * `escalation.claimed` event.
 *
 * @param input.id — escalation UUID
 * @param input.durationMinutes — claim duration (default: 30)
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { escalation, isExtension } }` or 403/404/409
 */
export async function claimEscalation(
  input: { id: string; durationMinutes?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, durationMinutes } = input;

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }

    const hasGlobal = await hasGlobalEscalationAccess(auth.userId);
    if (!hasGlobal) {
      const userHasRole = await userService.hasRole(auth.userId, escalation.role);
      if (!userHasRole) {
        return {
          status: 403,
          error: `You must have the "${escalation.role}" role to claim this escalation`,
        };
      }
    }

    const result = await escalationService.claimEscalation(id, auth.userId, durationMinutes);
    if (!result) {
      return { status: 409, error: 'Escalation not available for claim' };
    }

    // Event published by service layer (services/escalation/crud.ts)

    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Release a claimed escalation back to the pool.
 *
 * Only the user who holds the claim can release it. Publishes a
 * `escalation.released` event.
 *
 * @param input.id — escalation UUID
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { escalation } }` or 409
 */
export async function releaseEscalation(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const result = await escalationService.releaseEscalation(input.id, auth.userId);
    if (!result) {
      return { status: 409, error: 'Escalation not found or not claimed by you' };
    }

    return { status: 200, data: { escalation: result } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
