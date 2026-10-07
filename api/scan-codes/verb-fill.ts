import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { resolveBatchItem } from '../escalations/resolve-batch';
import { ESCALATION_BATCH_KEYS } from '../../types/escalation';
import {
  SCAN_ENCODINGS,
  SCAN_FILL_SEPARATOR_DEFAULT,
  SCAN_OUTCOMES,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { conflict, forbidden, provenance, refused, templateContext, withDone, type StepContext } from './context';
import { identityGate, spendGrant } from './grant';
import { locateForStep } from './locate';
import { claimedByOther } from './subject';

// ── FILL: check off one expected item by scanning it ────────────────────────
//
// The batch row declares one key per expected item: `<code>` or, when the
// same item is expected more than once, `<code>#1`, `<code>#2`. A scan fills
// the first open key for its code, so an item expected twice takes two scans
// and a third is refused. The last fill completes the row and wakes the
// workflow in the same statement.

type ScanResult = LTApiResult<ScanExecuteResponse>;

const STOCK_UNEXPECTED = 'Not one of the items expected here.';

interface Batch {
  pending: string[];
  keys: string[];
}

function readBatch(row: LTEscalationRecord): Batch | null {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const pending = meta[ESCALATION_BATCH_KEYS.PENDING];
  const keys = meta[ESCALATION_BATCH_KEYS.KEYS];
  if (!Array.isArray(pending)) return null;
  return { pending: pending.map(String), keys: Array.isArray(keys) ? keys.map(String) : pending.map(String) };
}

/** The code a batch key names, without its ordinal suffix. */
function codeOf(key: string, separator: string): string {
  const at = key.lastIndexOf(separator);
  return at > 0 && /^[0-9]+$/.test(key.slice(at + 1)) ? key.slice(0, at) : key;
}

function keysFor(keys: string[], target: string, separator: string): string[] {
  return keys.filter((k) => codeOf(k, separator) === target);
}

function progress(batch: Batch, filledNow: number): ScanExecuteResponse['progress'] {
  const remaining = Math.max(0, batch.pending.length - filledNow);
  return { filled: batch.keys.length - remaining, total: batch.keys.length, remaining };
}

export async function fillStep(step: ScanStep, ctx: StepContext): Promise<ScanResult | null> {
  const options = step.params!.fill!;
  const separator = options.separator ?? SCAN_FILL_SEPARATOR_DEFAULT;

  // 1. The batch row: the held subject, or the row the scan names
  const row = options.into === 'subject'
    ? ctx.subject!.row
    : (await locateForStep(step, ctx, 1))?.escalations[0];
  if (!row) return null;
  if (options.into === 'subject' && step.subject?.claimedByOther !== 'allow') {
    const other = await claimedByOther(row, ctx.auth.userId);
    if (other) return refused(`Claimed by **${other.displayName}**.`);
  }
  const batch = readBatch(row);
  if (!batch) return conflict('the held row is not a batch');

  // 2. Which open slot this scan fills, or why none
  const tpl = {
    ...templateContext(ctx),
    fill: {
      pending: [...new Set(batch.pending.map((k) => codeOf(k, separator)))],
      total: batch.keys.length,
      filled: batch.keys.length - batch.pending.length,
    },
  };
  const candidates = keysFor(batch.pending, ctx.parsed.target, separator);
  if (candidates.length === 0) {
    const declared = keysFor(batch.keys, ctx.parsed.target, separator);
    const markdown = declared.length
      ? `All ${declared.length} of these are already checked off.`
      : scanCodeService.renderScanCopy(step.refuse?.markdown ?? STOCK_UNEXPECTED, tpl);
    const expected = ctx.scheme.encoding === SCAN_ENCODINGS.GTIN
      ? tpl.fill.pending.map((code) => scanCodeService.displayGtin(code))
      : tpl.fill.pending;
    return refused(markdown, {
      refusal: { markdown, expected },
      progress: progress(batch, 0),
    });
  }

  // 3. Spend the badge, then fill; a slot taken since the read moves to the next
  let payload: Record<string, any>;
  try {
    payload = scanCodeService.interpolateScanTemplate(options.payload ?? { scannedCode: '{scan.code}' }, tpl);
  } catch (err) {
    if (err instanceof scanCodeService.ScanTemplateError) return null;
    throw err;
  }
  const notPrimed = (await identityGate(step, ctx)) ?? (await spendGrant(ctx));
  if (notPrimed) return notPrimed;
  for (const itemKey of candidates) {
    const result = await resolveBatchItem({
      id: row.id, itemKey, resolverPayload: payload, metadata: provenance(ctx),
    }, ctx.auth);
    if (result.status === 200) {
      const data = result.data as { outcome: string; remaining?: number };
      const done = data.outcome === 'completed';
      const filled = progress(batch, batch.pending.length - (done ? 0 : (data.remaining ?? 0)));
      return withDone({
        status: 200,
        data: {
          outcome: SCAN_OUTCOMES.EXECUTED,
          verb: step.verb,
          escalation: { id: row.id, ...data },
          progress: filled,
          ...(done ? { clearSubject: true } : {}),
        },
      }, step, { ...tpl, fill: { ...tpl.fill, ...filled } });
    }
    const outcome = (result.data as { outcome?: string } | undefined)?.outcome;
    if (outcome === 'duplicate-item') continue;
    if (result.status === 403) return forbidden(result.error);
    if (result.status === 404) return null;
    if (outcome?.startsWith('already-')) return refused('This one is already complete.', { clearSubject: true });
    return refused(result.error ?? STOCK_UNEXPECTED);
  }
  const fresh = await escalationService.getEscalation(row.id);
  const after = fresh ? readBatch(fresh) : null;
  return refused(`All ${keysFor(batch.keys, ctx.parsed.target, separator).length} of these are already checked off.`, {
    ...(after ? { progress: progress(after, 0) } : {}),
  });
}
