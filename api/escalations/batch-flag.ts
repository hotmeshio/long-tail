import * as escalationService from '../../services/escalation';
import { ESCALATION_BATCH_KEYS } from '../../types/escalation';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

import { assertReadAccess, assertWriteAccess } from './helpers';
import { resolverIdentity } from './resolve';

const LABEL_MAX = 128;

/** True when the row's wait declared `wakeOnFlag` (stored on its envelope at creation). */
export function wakesOnFlag(envelope: unknown): boolean {
  let parsed = envelope;
  if (typeof envelope === 'string') {
    try { parsed = JSON.parse(envelope); } catch { return false; }
  }
  return !!parsed && typeof parsed === 'object'
    && (parsed as Record<string, unknown>)[ESCALATION_BATCH_KEYS.WAKE_ON_FLAG] === true;
}

/** Read and write gates shared by flag and unflag: 404 for a row the caller cannot see, 403 for one they cannot act on. */
async function loadWritable(id: string, auth: LTApiAuth): Promise<LTApiResult | { row: any }> {
  const row = await escalationService.getEscalation(id);
  if (!row || (await assertReadAccess(auth.userId, row))) return { status: 404, error: 'Escalation not found' };
  const denied = await assertWriteAccess(auth.userId, row);
  if (denied) return denied;
  return { row };
}

/**
 * Flag one pending key of a batch escalation (for example, `Missing`). The
 * key stays pending and still fills. When the row's wait declared
 * `wakeOnFlag`, the flag ends the wait and the row records its resolver.
 */
export async function flagBatchItem(
  input: { id: string; itemKey: string; label: string; payload?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, itemKey, label, payload } = input;
    if (!itemKey || typeof itemKey !== 'string') return { status: 400, error: 'itemKey is required' };
    if (!label || typeof label !== 'string' || label.length > LABEL_MAX) {
      return { status: 400, error: `label is required (at most ${LABEL_MAX} characters)` };
    }
    if (payload !== undefined && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
      return { status: 400, error: 'payload must be an object' };
    }
    const gate = await loadWritable(id, auth);
    if (!('row' in gate)) return gate;
    const wakes = wakesOnFlag(gate.row.envelope);

    const result = await escalationService.flagBatchItem(id, itemKey, {
      label,
      ...(payload ? { payload } : {}),
      actor: auth.userId,
      ...(wakes ? { metadata: { resolved_by: auth.userId }, resolvedBy: await resolverIdentity(auth) } : {}),
    });
    return flagResult(result.outcome, itemKey, id, gate.row.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Clear one key's flag while the row is pending. */
export async function unflagBatchItem(
  input: { id: string; itemKey: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, itemKey } = input;
    if (!itemKey || typeof itemKey !== 'string') return { status: 400, error: 'itemKey is required' };
    const gate = await loadWritable(id, auth);
    if (!('row' in gate)) return gate;
    const result = await escalationService.unflagBatchItem(id, itemKey);
    return flagResult(result.outcome, itemKey, id, gate.row.workflow_id);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Maps the flag outcome vocabulary onto HTTP results. */
function flagResult(outcome: string, itemKey: string, id: string, workflowId: string | null): LTApiResult {
  const refuse = (status: number, error: string): LTApiResult =>
    ({ status, error, data: { error, outcome, itemKey } });
  switch (outcome) {
    case 'flagged':
    case 'unflagged':
      return { status: 200, data: { outcome, itemKey, escalationId: id } };
    case 'completed':
      return { status: 200, data: { outcome, itemKey, escalationId: id, workflowId } };
    case 'not-found':
      return refuse(404, 'Escalation not found');
    case 'not-batch':
      return refuse(400, 'Escalation is not a batch');
    case 'unknown-item':
      return refuse(400, 'itemKey is not in the declared batch');
    case 'already-filled':
      return refuse(409, 'This item is already in');
    case 'not-flagged':
      return refuse(409, 'This item has no flag');
    default:
      return refuse(409, 'Escalation is no longer pending');
  }
}
