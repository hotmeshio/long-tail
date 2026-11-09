import * as escalationService from '../../services/escalation';
import { claimSecondsLeft, readFileRefs, signFileRefs } from '../../services/escalation/file-links';
import { assertReadAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

/**
 * Sign an escalation's stored files.
 *
 * The refs on `envelope.files` ARE the grant: any user who may read the
 * escalation receives a time-limited link to exactly the files it names,
 * nothing else in storage. A link lives for the ref's `expiresIn` (else the
 * default), stretched to cover the reader's own live claim, within the
 * configured bounds. A ref that is malformed or cannot be signed answers
 * with `error`; the batch never fails.
 *
 * @param input.id: escalation UUID
 * @param auth: authenticated user context (must hold the escalation's role)
 * @returns `{ status: 200, data: { files: [{ as, path, name, contentType, url?, expiresAt?, error? }] } }`
 */
export async function getEscalationFiles(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const escalation = await escalationService.getEscalation(input.id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }

    const denied = await assertReadAccess(auth.userId, escalation);
    if (denied) return denied;

    const refs = readFileRefs(escalation.envelope);
    if (refs.length === 0) {
      return { status: 200, data: { files: [] } };
    }

    const files = await signFileRefs(refs, claimSecondsLeft(escalation, auth.userId));
    return { status: 200, data: { files } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
