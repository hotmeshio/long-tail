import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { isUuid } from '../../lib/uuid';
import { assertReadAccess } from '../escalations/helpers';
import {
  SCAN_SCHEME_KINDS,
  isEffectivelyClaimed,
  type LTEscalationRecord,
  type ScanScheme,
  type ScanSubjectRef,
} from '../../types';
import type { LTApiAuth } from '../../types/sdk';
import type { HeldSubject } from './context';

// ── The held subject ────────────────────────────────────────────────────────
//
// The station remembers the item it just scanned by sending back a pointer:
// the code that held it and the row id the hold returned. Nothing about the
// pointer is trusted. Each request re-parses the code, re-reads the row under
// the station's own read scope, requires the row to still carry the code's
// target on its scheme facet (so an id cannot borrow another item's code), and
// requires it to be pending. A pointer that fails is stale: the station drops
// it and the scan proceeds as if none were held.

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

  const row = await escalationService.getEscalation(ref.escalationId);
  if (!row || row.status !== 'pending') return { ok: false };
  if (await assertReadAccess(stationAuth.userId, row)) return { ok: false };
  if ((row.metadata as Record<string, unknown> | null)?.[parsed.scheme.target_facet] !== parsed.parsed.target) {
    return { ok: false };
  }
  return { ok: true, subject: { row, parsed: parsed.parsed, scheme: parsed.scheme, code: ref.code } };
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
