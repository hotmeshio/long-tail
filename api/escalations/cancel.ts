import * as escalationService from '../../services/escalation';
import { validateIds, checkBulkPermission, assertWriteAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

/**
 * Cancel a single escalation. The caller must hold global escalation access
 * or the escalation's role.
 *
 * @returns `{ status: 200, data: { cancelled: true } }` or 403/404/409/500
 */
export async function cancelSingleEscalation(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id } = input;
    if (!id) return { status: 400, error: 'id is required' };

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };

    // Cancel ("delete") is a write verb: write_all may cancel any item in the role,
    // write_self may cancel an item assigned to them, read-only members may not.
    const denied = await assertWriteAccess(auth.userId, escalation);
    if (denied) return denied;

    const cancelled = await escalationService.cancelEscalation(id);
    if (!cancelled) {
      return { status: 409, error: 'Escalation is not cancellable (already terminal)' };
    }
    return { status: 200, data: { cancelled: true, escalationId: id } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Cancel multiple escalations at once.
 *
 * @param input.ids — array of escalation UUIDs
 * @param auth — authenticated user context (admin required)
 * @returns `{ status: 200, data: { cancelled, skipped } }`
 */
export async function bulkCancel(
  input: { ids: string[] },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids } = input;
    if (!validateIds(ids)) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }

    const perm = await checkBulkPermission(auth.userId, ids);
    if (!perm.allowed) return perm;

    const result = await escalationService.bulkCancelEscalations(ids);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
