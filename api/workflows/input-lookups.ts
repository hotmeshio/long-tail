import * as configService from '../../services/config';
import * as userService from '../../services/user';
import { canInvokeWorkflow } from '../../services/invocation-access';
import { resolveLookupRefs } from '../../services/knowledge';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

/**
 * Resolve the versioned knowledge lookups pinned on a workflow config.
 *
 * The refs on `input_lookups` ARE the grant: any caller who may invoke the
 * workflow may read exactly the pinned editions it names. A ref whose
 * snapshot does not exist answers with `missing: true`; the batch never
 * fails.
 *
 * @param input.type: workflow type name
 * @param auth: authenticated caller; must pass the invoke predicate
 * @returns `{ status: 200, data: { lookups: [{ domain, key, version, as?, data, missing? }] } }`
 */
export async function getWorkflowInputLookups(
  input: { type: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const config = await configService.getWorkflowConfig(input.type);
    if (!config) {
      return { status: 404, error: 'Workflow config not found' };
    }

    const user = auth.userId ? await userService.getUser(auth.userId) : null;
    if (!canInvokeWorkflow(config, user?.roles ?? [], auth.role)) {
      return { status: 403, error: 'Not authorized to invoke this workflow' };
    }

    const lookups = await resolveLookupRefs(config.input_lookups ?? []);
    return { status: 200, data: { lookups } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
