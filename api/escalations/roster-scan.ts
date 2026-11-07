import * as scanCodeService from '../../services/scan-code';
import { loadRoster } from '../../services/escalation/roster';
import {
  ROSTER_STATES,
  enteredCodeMatches,
  readRosterDef,
  readScanSink,
  rosterRowContext,
  type ShowIfContext,
} from '../../shared/form-validation';
import { SCAN_SCHEME_KINDS } from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

import { actorFor, loadHostField, spendAndRun } from './roster-action';
import { resolveBatchItem } from './resolve-batch';

/** Outcomes a roster scan answers with besides the fill's own result. */
export const ROSTER_SCAN_OUTCOMES = {
  /** The field takes no scans, or not this code's scheme. */
  NOT_ACCEPTED: 'not_accepted',
  /** No open entry on the list is this code. */
  UNEXPECTED: 'unexpected',
} as const;

const STOCK_UNEXPECTED = 'Not one of the items expected here.';
/** A batch fill whose key was filled since the roster was read. */
const DUPLICATE_ITEM = 'duplicate-item';

export interface RosterScanInput {
  /** The host row: the escalation whose form declares the roster. */
  id: string;
  /** The roster field. */
  field: string;
  /** The code as scanned. */
  code: string;
  /** A badge grant: the fill runs as its person. */
  actingToken?: string;
}

function refused(status: number, outcome: string, error: string): LTApiResult {
  return { status, error, data: { error, outcome } };
}

/**
 * A scan into a batch roster on an open form. The field must declare
 * `x-lt-scan` accepting the code's scheme; the scan fills the first open
 * entry whose key is that code, as the person acting, with `scannedCode` as
 * the entry's payload. Nothing about the request is trusted: the roster and
 * its entries are re-read from the host row.
 */
export async function runRosterScan(input: RosterScanInput, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    if (!input?.id || typeof input.field !== 'string' || typeof input.code !== 'string' || !input.code.trim()) {
      return { status: 400, error: 'id, field and code are required' };
    }

    // 1. The host row and a batch roster that takes this code's scheme
    const loaded = await loadHostField(input.id, input.field, auth);
    if (!loaded) return { status: 404, error: 'Escalation not found' };
    const def = readRosterDef(loaded.fieldSchema);
    const sink = readScanSink(loaded.fieldSchema);
    if (!def || !('batch' in def.expected) || !sink) {
      return refused(409, ROSTER_SCAN_OUTCOMES.NOT_ACCEPTED, 'This list takes no scans');
    }
    const parsed = scanCodeService.parseScanCode(input.code.trim(), await scanCodeService.listScanSchemes());
    if (!parsed.ok || parsed.scheme.kind !== SCAN_SCHEME_KINDS.ACTION || !sink.schemes.includes(parsed.parsed.version)) {
      return refused(422, ROSTER_SCAN_OUTCOMES.NOT_ACCEPTED, 'This list takes no code like that');
    }
    const value = sink.value === 'code' ? (parsed.parsed.raw ?? input.code.trim()) : parsed.parsed.target;

    // 2. The open entries this code names, on the roster the server computes
    const { escalation, metadata, envelope, payload } = rosterRowContext(loaded.host as unknown as Record<string, unknown>);
    const ctx: ShowIfContext = { escalation, metadata, envelope, payload };
    const roster = await loadRoster(def, ctx);
    const named = roster.entries.filter((e) => enteredCodeMatches(value, e.key, def.countedBy));
    const open = named.filter((e) => e.state !== ROSTER_STATES.IN);
    if (open.length === 0) {
      const error = named.length ? `All ${named.length} of these are already checked off.` : STOCK_UNEXPECTED;
      return refused(422, ROSTER_SCAN_OUTCOMES.UNEXPECTED, error);
    }

    // 3. Fill as the person acting; an entry taken since the read moves to the next
    const actor = await actorFor(input.actingToken, auth);
    if ('status' in actor) return actor;
    return spendAndRun(input.actingToken, async () => {
      let result: LTApiResult = { status: 409, error: 'Those entries were just checked off' };
      for (const entry of open) {
        result = await resolveBatchItem({
          id: loaded.host.id,
          itemKey: entry.key,
          resolverPayload: { scannedCode: input.code.trim() },
        }, actor);
        if ((result.data as { outcome?: string } | undefined)?.outcome !== DUPLICATE_ITEM) return result;
      }
      return result;
    });
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
