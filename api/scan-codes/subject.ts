import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { isUuid } from '../../lib/uuid';
import { assertReadAccess } from '../escalations/helpers';
import {
  SCAN_SCHEME_KINDS,
  SCAN_TARGET_MATCH,
  isEffectivelyClaimed,
  type LTEscalationRecord,
  type ScanScheme,
  type ScanSubjectRef,
} from '../../types';
import type { LTApiAuth } from '../../types/sdk';
import type { HeldSubject } from './context';
import { facetHolds } from '../../shared/scan-code';
import { ESCALATION_TRIGGER_FILL, ESCALATION_TRIGGER_KEY } from '../../types/escalation';

// ── The held subject ────────────────────────────────────────────────────────
//
// The station remembers the item it just scanned by sending back a pointer:
// the code that held it and the row id the hold returned. Nothing about the
// pointer is trusted. Each request re-parses the code, re-reads the row under
// the station's own read scope, requires the row to still carry the code's
// target on its scheme facet (so an id cannot borrow another item's code), and
// requires it to be pending. A row a fill resolved to wake its wait continues
// as that workflow's next round, which the subject follows. A pointer that
// fails is stale: the station drops it and the scan proceeds as if none were
// held.

export type SubjectResult =
  | { ok: true; subject: HeldSubject }
  | { ok: false };

export async function resolveSubject(
  ref: ScanSubjectRef | undefined,
  schemes: ScanScheme[],
  stationAuth: LTApiAuth,
): Promise<SubjectResult | null> {
  if (!ref) return null;
  if (typeof ref.code !== 'string' || !isUuid(ref.escalationId)) return { ok: false };

  const parsed = scanCodeService.parseScanCode(ref.code, schemes);
  if (!parsed.ok || parsed.scheme.kind !== SCAN_SCHEME_KINDS.ACTION) return { ok: false };

  const held = await escalationService.getEscalation(ref.escalationId);
  const row = held?.status === 'pending' ? held : await nextRound(held, parsed.scheme, parsed.parsed.target);
  if (!row) return { ok: false };
  if (await assertReadAccess(stationAuth.userId, row)) return { ok: false };
  if (!facetHolds((row.metadata as Record<string, unknown> | null)?.[parsed.scheme.target_facet], parsed.parsed.target)) {
    return { ok: false };
  }
  return { ok: true, subject: { row, parsed: parsed.parsed, scheme: parsed.scheme, code: ref.code } };
}

/**
 * The pending round that follows a row a fill resolved to wake its wait
 * (`$trigger: 'fill'`): the one pending row in the same role, of the same
 * workflow, carrying the same target. Null when there is none yet.
 */
async function nextRound(
  held: LTEscalationRecord | null,
  scheme: ScanScheme,
  target: string,
): Promise<LTEscalationRecord | null> {
  if (!held || held.status !== 'resolved' || !held.workflow_id) return null;
  if (resolverTrigger(held) !== ESCALATION_TRIGGER_FILL) return null;
  const value = scheme.target_match === SCAN_TARGET_MATCH.MEMBER ? [target] : target;
  const { escalations } = await escalationService.searchByFacets({
    roles: [held.role], facets: { [scheme.target_facet]: value }, status: 'pending', limit: 2,
  });
  const rounds = escalations.filter((e) => e.workflow_id === held.workflow_id);
  return rounds.length === 1 ? rounds[0] : null;
}

function resolverTrigger(row: LTEscalationRecord): unknown {
  try {
    const payload = typeof row.resolver_payload === 'string' ? JSON.parse(row.resolver_payload) : row.resolver_payload;
    return payload?.[ESCALATION_TRIGGER_KEY];
  } catch {
    return undefined;
  }
}

/** Who holds a live claim on the row, when that is someone other than `actorId`. */
export async function claimedByOther(
  row: LTEscalationRecord,
  actorId: string | null,
): Promise<{ id: string; displayName: string } | null> {
  if (!row.assigned_to || !isEffectivelyClaimed(row) || row.assigned_to === actorId) return null;
  const user = await userService.getUser(row.assigned_to);
  return { id: row.assigned_to, displayName: user?.display_name || user?.external_id || 'another associate' };
}
