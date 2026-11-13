import { isUuid } from '../../lib/uuid';
import { durableProviderRegistry, foldWaitDeclaration, openWait, SignalKeyTakenError, WaitDeclarationError, WAIT_LIMITS } from '../../services/durable-provider';
import * as escalationService from '../../services/escalation';
import { providerEscalationIdFor } from '../../services/escalation/provider-waits';
import type { LTOpenWaitInput } from '../../types/durable-provider';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';
import { assertCreatable } from './create';
import { assertReadAccess } from './helpers';

const PRIORITIES = [1, 2, 3, 4];

/**
 * Open a wait for a workflow running on the configured durable provider
 * (Temporal, DBOS). Creates the escalation the workflow waits on, once per
 * (workflowId, runScope, waitKey); a repeat returns the same escalation.
 * The terminal outcome is delivered to the workflow by the relay.
 *
 * @returns 201 with `{ escalationId, status, created: true }`; 200 for a repeat
 */
export async function openDurableWait(input: Partial<LTOpenWaitInput>, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    if (durableProviderRegistry.isNative) {
      return { status: 501, error: 'No durable provider is configured; HotMesh workflows open escalations with conditional()' };
    }
    const invalid = invalidWaitInput(input);
    if (invalid) return { status: 400, error: invalid };
    const valid = input as LTOpenWaitInput;
    const undeclarable = refuseDeclaration(valid);
    if (undeclarable) return { status: 400, error: undeclarable };

    const refused = await assertCreatable(valid.role, valid.metadata ?? {}, auth);
    if (refused) return refused;
    const unlinked = await refuseLineage(valid, auth);
    if (unlinked) return unlinked;
    if (valid.signalKey && await signalKeyHeldByHotMesh(valid.signalKey)) {
      return { status: 409, error: `signal key ${valid.signalKey} is held by another escalation` };
    }

    const { escalation, created } = await openWait(durableProviderRegistry.name, valid, auth.userId);
    return {
      status: created ? 201 : 200,
      data: { escalationId: escalation.id, status: escalation.status, created },
    };
  } catch (err: any) {
    if (err instanceof SignalKeyTakenError) return { status: 409, error: err.message };
    return { status: 500, error: err.message };
  }
}

/** Why the body is not a valid wait, or null. */
function invalidWaitInput(input: Partial<LTOpenWaitInput>): string | null {
  if (!nonEmpty(input.workflowId, WAIT_LIMITS.WORKFLOW_ID_MAX)) return 'workflowId is required';
  if (!nonEmpty(input.waitKey, WAIT_LIMITS.KEY_MAX)) return `waitKey must be a non-empty string of at most ${WAIT_LIMITS.KEY_MAX} characters`;
  if (input.runScope !== undefined && typeof input.runScope !== 'string') return 'runScope must be a string';
  if (!nonEmpty(input.role)) return 'role is required';
  if (!nonEmpty(input.type)) return 'type is required';
  if (input.priority !== undefined && !PRIORITIES.includes(input.priority)) return 'priority must be 1, 2, 3 or 4';
  if (input.metadata !== undefined && !isPlainObject(input.metadata)) return 'metadata must be an object';
  if (input.data !== undefined && !isPlainObject(input.data)) return 'data must be an object';
  if (input.expiresAt !== undefined && Number.isNaN(Date.parse(String(input.expiresAt)))) return 'expiresAt must be an ISO date';
  if (input.envelope !== undefined && !isPlainObject(input.envelope)) return 'envelope must be an object';
  if (input.lookups !== undefined && !Array.isArray(input.lookups)) return 'lookups must be an array';
  if (input.files !== undefined && !Array.isArray(input.files)) return 'files must be an array';
  if (input.schemaVersion !== undefined && !(Number.isInteger(input.schemaVersion) && input.schemaVersion! > 0)) return 'schemaVersion must be a positive integer';
  if (input.assignee !== undefined && !nonEmpty(input.assignee, WAIT_LIMITS.KEY_MAX)) return 'assignee must be a non-empty string';
  if (input.durationMinutes !== undefined) {
    if (!(typeof input.durationMinutes === 'number' && Number.isFinite(input.durationMinutes) && input.durationMinutes > 0)) return 'durationMinutes must be a positive number';
    if (input.assignee === undefined) return 'durationMinutes requires assignee';
  }
  if (input.originId !== undefined && !isUuid(input.originId)) return 'originId must be an escalation id';
  if (input.parentId !== undefined && !isUuid(input.parentId)) return 'parentId must be an escalation id';
  if (input.signalKey !== undefined && !nonEmpty(input.signalKey, WAIT_LIMITS.KEY_MAX)) return `signalKey must be a non-empty string of at most ${WAIT_LIMITS.KEY_MAX} characters`;
  return null;
}

/**
 * Whether a HotMesh escalation holds `signalKey` while no wait does. Once a
 * wait holds the key, opening it again returns that wait, and another wait
 * asking for the key gets the unique violation.
 */
async function signalKeyHeldByHotMesh(signalKey: string): Promise<boolean> {
  if (await providerEscalationIdFor(signalKey)) return false;
  return escalationService.hotMeshHoldsSignalKey(signalKey);
}

/**
 * Why `originId` / `parentId` can't be linked, or null. Each must name an
 * escalation the caller can read (404 otherwise, so ids aren't disclosed),
 * and with both, `originId` must be the parent's origin.
 */
async function refuseLineage(input: LTOpenWaitInput, auth: LTApiAuth): Promise<LTApiResult | null> {
  const [origin, parent] = await Promise.all([input.originId, input.parentId].map(async (id) => {
    if (id === undefined) return undefined;
    const row = await escalationService.getEscalation(id);
    return row && !(await assertReadAccess(auth.userId, row)) ? row : null;
  }));
  if (origin === null) return { status: 404, error: 'originId: escalation not found' };
  if (parent === null) return { status: 404, error: 'parentId: escalation not found' };
  if (origin && parent && origin.id !== (parent.origin_id ?? parent.id)) {
    return { status: 400, error: 'originId must be the origin of parentId' };
  }
  return null;
}

/** Why the batch or accumulate declaration is invalid, or null. */
function refuseDeclaration(input: LTOpenWaitInput): string | null {
  try {
    foldWaitDeclaration(input);
    return null;
  } catch (err) {
    if (err instanceof WaitDeclarationError) return err.message;
    throw err;
  }
}

function nonEmpty(value: unknown, max = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
