import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { accumulateItem } from '../escalations/accumulate';
import { getEscalationReadScope } from '../escalations/helpers';
import { restrictScopeRoles } from '../escalations/metadata';
import { ESCALATION_ACCUMULATE_KEYS } from '../../types/escalation';
import {
  SCAN_OUTCOMES,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { conflict, refused, withDone, type StepContext } from './context';
import { identityGate, spendGrant } from './grant';
import { claimedByOther } from './subject';
import { already, bags, claimGuard, failedAdd, matchGuard, rendered } from './verbs-subject';

type ScanResult = LTApiResult<ScanExecuteResponse>;

const STOCK_MISSING = 'That one is not waiting here.';
const ITEM_GONE = ['reciprocal-not-found', 'reciprocal-not-accumulator'];

type ItemLocate = { row?: LTEscalationRecord } | { ambiguous: true };

/**
 * The scanned code's own pending row: an accumulator carrying the scheme's
 * target facet = the scanned target, within the selector and the actor's
 * read scope. The held subject's row is never a candidate.
 */
async function locateItem(step: ScanStep, ctx: StepContext): Promise<ItemLocate> {
  const selector = step.params!.accumulate!.item!;
  const scope = await getEscalationReadScope(ctx.auth.userId);
  const roles = restrictScopeRoles(scope.allRoles, scope.global, selector.roles);
  if (roles !== null && roles.length === 0) return {};
  const found = await escalationService.searchByFacets({
    roles: roles ?? undefined,
    types: selector.types,
    subtypes: selector.subtypes,
    facets: { ...selector.facets, [ctx.scheme.target_facet]: ctx.parsed.target },
    status: 'pending',
    exists: [ESCALATION_ACCUMULATE_KEYS.COUNT],
    limit: 3,
  }, { total: false });
  const rows = found.escalations.filter((row) => row.id !== ctx.subject?.row.id);
  return rows.length > 1 ? { ambiguous: true } : { row: rows[0] };
}

/** The missing-item answer: the rule's copy when declared, else fall through. */
function missing(step: ScanStep, ctx: StepContext): ScanResult | null {
  if (!step.refuse?.missing) return null;
  const copy = scanCodeService.renderScanCopy(step.refuse.missing, bags(ctx, ctx.subject?.row));
  return refused(copy, { clearSubject: false });
}

/** Progress of a bounded accumulator after an add; unbounded rows report none. */
function progressOf(data: { count: number; remaining: number | null }): ScanExecuteResponse['progress'] {
  if (data.remaining === null || data.remaining === undefined) return undefined;
  return { filled: data.count, total: data.count + data.remaining, remaining: data.remaining };
}

/**
 * The held subject's row collects the scanned code. With `accumulate.item`,
 * the code's own pending row is located and written as the reciprocal in the
 * same statement, so the item's record and the subject's entry land together
 * or not at all.
 */
export async function accumulateIntoSubject(step: ScanStep, ctx: StepContext): Promise<ScanResult | null> {
  const subject = ctx.subject!;
  const claimed = await claimGuard(step, ctx, subject);
  if (claimed) return claimed;

  // 1. Locate the scanned item's own row when the step names one
  let item: LTEscalationRecord | undefined;
  const wantsItem = !!step.params?.accumulate?.item;
  if (wantsItem) {
    const located = await locateItem(step, ctx);
    if ('ambiguous' in located) {
      return conflict(`more than one pending row carries ${ctx.scheme.target_facet} = ${ctx.parsed.target}`);
    }
    item = located.row;
  }

  // 2. Check the pairing before anything is written
  if (wantsItem && !item) return missing(step, ctx);
  const mismatch = matchGuard(step, ctx, subject.row, item);
  if (mismatch) return mismatch;
  if (item && step.subject?.claimedByOther !== 'allow') {
    const other = await claimedByOther(item, ctx.auth.userId);
    if (other) return refused(`Claimed by **${other.displayName}**.`, { clearSubject: false });
  }

  // 3. Spend the badge, then write both rows in one statement
  const values = rendered(step, ctx, '{scan.target}', item);
  if (!values) return null;
  const notPrimed = (await identityGate(step, ctx)) ?? (await spendGrant(ctx));
  if (notPrimed) return notPrimed;
  const result = await accumulateItem({
    id: subject.row.id,
    itemKey: values.itemKey,
    payload: values.payload,
    metadata: values.metadata,
    ...(item ? { reciprocal: { id: item.id } } : {}),
  }, ctx.auth);

  // 4. Report
  if (result.status !== 200) {
    const outcome = (result.data as { outcome?: string } | undefined)?.outcome;
    if (outcome === 'duplicate-item') return already(step, subject.row, true);
    if (item && outcome && ITEM_GONE.includes(outcome)) return missing(step, ctx) ?? refused(STOCK_MISSING, { clearSubject: false });
    return failedAdd(step, ctx, result, subject.row, !!item);
  }
  const data = result.data as { outcome: string; count: number; remaining: number | null };
  const progress = progressOf(data);
  return withDone({
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.EXECUTED,
      verb: step.verb,
      escalation: { id: subject.row.id, ...result.data },
      clearSubject: data.outcome === 'completed',
      ...(progress ? { progress } : {}),
    },
  }, step, bags(ctx, afterAdd(subject.row, values.metadata, data.count), item));
}

/** The subject's row as the add left it, for `{container.…}` copy, without a re-read. */
function afterAdd(row: LTEscalationRecord, patch: Record<string, any>, count: number): LTEscalationRecord {
  return { ...row, metadata: { ...(row.metadata ?? {}), ...patch, [ESCALATION_ACCUMULATE_KEYS.COUNT]: count } };
}
