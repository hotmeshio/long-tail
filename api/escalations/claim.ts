import * as escalationService from '../../services/escalation';

import { assertWriteAccess, assertQueueManageAccess, ensureRoleMembership, type ProvisionIfAbsent } from './helpers';
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
  input: { id: string; durationMinutes?: number; provisionIfAbsent?: ProvisionIfAbsent },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, durationMinutes, provisionIfAbsent } = input;

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }

    // Write-scope gate: write_all may claim any item in the role; write_self may
    // only (re)claim an item already assigned to them (extension); read-only and
    // non-members are denied. Global access bypasses.
    const writeDenied = await assertWriteAccess(auth.userId, escalation);
    if (writeDenied) {
      // Unhappy path: a global caller may JIT-provision their own role membership
      // (ensureRoleMembership requires global authority, so this no-ops otherwise).
      const provisioned = await ensureRoleMembership(
        auth.userId, escalation.role, auth.userId, provisionIfAbsent,
      );
      if (!provisioned) return writeDenied;
    }

    const result = await escalationService.claimEscalation(id, auth.userId, durationMinutes);
    if (!result) {
      return { status: 409, error: 'Escalation not available for claim' };
    }

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
    const escalation = await escalationService.getEscalation(input.id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };

    // Releasing returns the item to the pool — a queue-management verb. A
    // self-scope owner cannot release (it would forfeit access to their own item).
    const manageDenied = await assertQueueManageAccess(auth.userId, escalation.role);
    if (manageDenied) return manageDenied;

    const result = await escalationService.releaseEscalation(input.id, auth.userId);
    if (!result) {
      return { status: 409, error: 'Escalation not found or not claimed by you' };
    }

    return { status: 200, data: { escalation: result } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
