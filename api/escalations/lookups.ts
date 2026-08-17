import * as escalationService from '../../services/escalation';
import { resolveLookupRefs, type ResolvedLookup } from '../../services/knowledge';
import { ESCALATION_ENVELOPE_KEYS, type EscalationLookupRef } from '../../types/escalation';
import { assertReadAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// ── Lookups ────────────────────────────────────────────────────────────────

/** The refs riding the row's envelope under the reserved key, or []. */
export function readLookupRefs(envelope: string | null | undefined): EscalationLookupRef[] {
  if (!envelope) return [];
  try {
    const parsed = JSON.parse(envelope);
    const refs = parsed && typeof parsed === 'object'
      ? parsed[ESCALATION_ENVELOPE_KEYS.LOOKUPS]
      : undefined;
    return Array.isArray(refs) ? (refs as EscalationLookupRef[]) : [];
  } catch {
    return [];
  }
}

/**
 * Resolve an escalation's versioned knowledge lookups.
 *
 * The refs on `envelope.lookups` ARE the grant: any user who may read the
 * escalation may read exactly the pinned editions it names — nothing else in
 * the knowledge store. Snapshots are immutable, so responses are served from
 * an in-process cache after the first read; a ref whose snapshot does not
 * exist answers with `missing: true` rather than failing the batch.
 *
 * @param input.id — escalation UUID
 * @param auth — authenticated user context (must hold the escalation's role)
 * @returns `{ status: 200, data: { lookups: [{ domain, key, version, as?, data, missing? }] } }`
 */
export async function getEscalationLookups(
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

    const refs = readLookupRefs(escalation.envelope);
    if (refs.length === 0) {
      return { status: 200, data: { lookups: [] as ResolvedLookup[] } };
    }

    const lookups = await resolveLookupRefs(refs);
    return { status: 200, data: { lookups } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
