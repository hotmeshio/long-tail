import { durableProviderRegistry, openWait, WAIT_LIMITS } from '../../services/durable-provider';
import type { LTOpenWaitInput } from '../../types/durable-provider';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';
import { assertCreatable } from './create';

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

    const refused = await assertCreatable(valid.role, valid.metadata ?? {}, auth);
    if (refused) return refused;

    const { escalation, created } = await openWait(durableProviderRegistry.name, valid, auth.userId);
    return {
      status: created ? 201 : 200,
      data: { escalationId: escalation.id, status: escalation.status, created },
    };
  } catch (err: any) {
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
  return null;
}

function nonEmpty(value: unknown, max = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
