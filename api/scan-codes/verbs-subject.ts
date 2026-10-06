import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import { accumulateItem } from '../escalations/accumulate';
import { getEscalationReadScope } from '../escalations/helpers';
import { restrictScopeRoles } from '../escalations/metadata';
import {
  ESCALATION_ACCUMULATE_KEYS,
} from '../../types/escalation';
import {
  SCAN_OUTCOMES,
  type LTEscalationRecord,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import {
  conflict,
  forbidden,
  provenance,
  refused,
  templateContext,
  withDone,
  type HeldSubject,
  type StepContext,
} from './context';
import { identityGate, spendGrant } from './grant';
import { claimedByOther } from './subject';

// ── Acting on the held subject ──────────────────────────────────────────────
//
// The station holds an item; this scan names where it goes. The step checks
// the pairing first (match), refusing with nothing written when it is wrong,
// then writes by id in one atomic statement: the subject joins the scanned
// container with its own row as the reciprocal (from: 'subject'), or the
// subject's row collects the scanned code (into: 'subject').

const STOCK_REFUSAL = 'That is not where this one goes.';
const STOCK_CONFLICT = 'That container just closed. Scan it again, or the next one.';
const STOCK_PLACED = 'This one is already placed.';

type ScanResult = LTApiResult<ScanExecuteResponse>;

/** The step's template bags with the subject (and the container, once located). */
function bags(ctx: StepContext, container?: LTEscalationRecord): scanCodeService.ScanTemplateContext {
  return { ...templateContext(ctx), ...(container ? { container: container.metadata ?? {} } : {}) };
}

/** Refuse the act when someone else holds a live claim on the subject. */
async function claimGuard(step: ScanStep, ctx: StepContext, subject: HeldSubject): Promise<ScanResult | null> {
  if (step.subject?.claimedByOther === 'allow') return null;
  const other = await claimedByOther(subject.row, ctx.auth.userId);
  return other ? refused(`Claimed by **${other.displayName}**.`) : null;
}

/** The container the scan names: a pending accumulator under the actor's read scope. */
async function locateContainer(step: ScanStep, ctx: StepContext): Promise<LTEscalationRecord[] | null> {
  const selector = step.params?.accumulate?.container;
  const scope = await getEscalationReadScope(ctx.auth.userId);
  const roles = restrictScopeRoles(scope.allRoles, scope.global, selector?.roles ?? step.query?.roles);
  if (roles !== null && roles.length === 0) return null;
  const found = await escalationService.searchByFacets({
    roles: roles ?? undefined,
    types: selector?.types,
    subtypes: selector?.subtypes,
    facets: { ...selector?.facets, [ctx.scheme.target_facet]: ctx.parsed.target },
    status: 'pending',
    exists: [ESCALATION_ACCUMULATE_KEYS.COUNT],
    limit: 2,
  });
  return found.escalations.filter((row) => row.id !== ctx.subject?.row.id);
}

const WHOLE_BAG_TOKEN = /^\{(subject|container)\.([a-zA-Z0-9_]+)\}$/;

/**
 * One match.target template as the values it allows. A template that is a
 * single bag token naming a list facet (`{subject.offeredContainers}`) allows every
 * entry; anything else renders to one value. A token with nothing to read
 * allows nothing.
 */
function expandTarget(template: string, tpl: scanCodeService.ScanTemplateContext): string[] {
  const whole = template.match(WHOLE_BAG_TOKEN);
  if (whole) {
    const value = (tpl[whole[1] as 'subject' | 'container'] as Record<string, unknown> | undefined)?.[whole[2]];
    if (Array.isArray(value)) return value.filter((v) => v !== null && v !== '').map(String);
  }
  try {
    return [scanCodeService.interpolateScanTemplate(template, tpl)];
  } catch {
    return [];
  }
}

/**
 * The pre-write guard. Returns the refusal when the pairing is wrong, null
 * when it holds (or the step declares no match).
 */
export function matchGuard(step: ScanStep, ctx: StepContext, container?: LTEscalationRecord): ScanResult | null {
  const match = step.match;
  if (!match) return null;
  const tpl = bags(ctx, container);
  const expected = (match.target ?? []).flatMap((t) => expandTarget(t, tpl));
  const targetOk = match.target === undefined || expected.includes(ctx.parsed.target);
  const subjectMeta = (ctx.subject?.row.metadata ?? {}) as Record<string, unknown>;
  const containerMeta = (container?.metadata ?? {}) as Record<string, unknown>;
  // With no container located there is nothing to compare; the step falls through.
  const facetsOk = match.facets === undefined || !container || (match.facets.every((f) =>
    subjectMeta[f] !== undefined && subjectMeta[f] !== null && String(subjectMeta[f]) === String(containerMeta[f])));
  if (targetOk && facetsOk) return null;
  const markdown = scanCodeService.renderScanCopy(step.refuse?.markdown ?? STOCK_REFUSAL, tpl);
  return refused(markdown, { refusal: { markdown, ...(expected.length ? { expected } : {}) } });
}

/** Map a failed add onto what the bench says. 404 falls through. */
function failedAdd(step: ScanStep, ctx: StepContext, result: LTApiResult, container?: LTEscalationRecord): ScanResult | null {
  const outcome = (result.data as { outcome?: string } | undefined)?.outcome;
  if (result.status === 404) return null;
  if (result.status === 403) return forbidden(result.error);
  if (outcome === 'reciprocal-terminal' || outcome === 'reciprocal-full' || outcome === 'reciprocal-duplicate') {
    return refused(STOCK_PLACED, { clearSubject: true });
  }
  if (outcome === 'claimed-by-other' || outcome === 'claim-expired') return conflict(result.error);
  if (result.status === 409) {
    const markdown = scanCodeService.renderScanCopy(step.refuse?.conflict ?? STOCK_CONFLICT, bags(ctx, container));
    // A lost race for a shared container: the subject's offer may have moved, so drop it.
    return refused(markdown, { clearSubject: !!step.refuse?.conflict });
  }
  return refused(result.error ?? STOCK_REFUSAL);
}

function rendered(step: ScanStep, ctx: StepContext, itemKeyDefault?: string) {
  const tpl = templateContext(ctx);
  try {
    return {
      itemKey: scanCodeService.interpolateScanTemplate(step.params?.itemKey ?? itemKeyDefault ?? '', tpl),
      payload: step.params?.resolverPayload
        ? scanCodeService.interpolateScanTemplate(step.params.resolverPayload, tpl)
        : undefined,
      metadata: {
        ...(step.params?.metadata ? scanCodeService.interpolateScanTemplate(step.params.metadata, tpl) : {}),
        ...provenance(ctx),
      },
    };
  } catch (err) {
    if (err instanceof scanCodeService.ScanTemplateError) return null;
    throw err;
  }
}

/** The subject joins the scanned container; the subject's row is the reciprocal. */
export async function accumulateFromSubject(step: ScanStep, ctx: StepContext): Promise<ScanResult | null> {
  const subject = ctx.subject!;
  const claimed = await claimGuard(step, ctx, subject);
  if (claimed) return claimed;

  // 1. Locate the container the scan names
  const containers = await locateContainer(step, ctx);
  if (containers && containers.length > 1) {
    return conflict(`more than one open container carries ${ctx.scheme.target_facet} = ${ctx.parsed.target}`);
  }
  const container = containers?.[0];

  // 2. Check the pairing before anything is written
  const mismatch = matchGuard(step, ctx, container);
  if (mismatch) return mismatch;
  if (!container) {
    if (!step.refuse?.missing) return null;
    return refused(scanCodeService.renderScanCopy(step.refuse.missing, bags(ctx)));
  }

  // 3. Spend the badge, then write both rows in one statement
  const values = rendered(step, ctx);
  if (!values) return null;
  const notPrimed = (await identityGate(step, ctx)) ?? (await spendGrant(ctx));
  if (notPrimed) return notPrimed;
  const result = await accumulateItem({
    id: container.id,
    itemKey: values.itemKey,
    payload: values.payload,
    metadata: values.metadata,
    reciprocal: { id: subject.row.id },
  }, ctx.auth);

  // 4. Report
  if (result.status !== 200) {
    if ((result.data as { outcome?: string } | undefined)?.outcome === 'duplicate-item') {
      return already(step, container);
    }
    return failedAdd(step, ctx, result, container);
  }
  return withDone({
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.EXECUTED,
      verb: step.verb,
      escalation: { id: container.id, ...result.data },
      clearSubject: true,
    },
  }, step, bags(ctx, container));
}

/** The subject's own row collects the scanned code. */
export async function accumulateIntoSubject(step: ScanStep, ctx: StepContext): Promise<ScanResult | null> {
  const subject = ctx.subject!;
  const claimed = await claimGuard(step, ctx, subject);
  if (claimed) return claimed;
  const mismatch = matchGuard(step, ctx);
  if (mismatch) return mismatch;

  const values = rendered(step, ctx, '{scan.target}');
  if (!values) return null;
  const notPrimed = (await identityGate(step, ctx)) ?? (await spendGrant(ctx));
  if (notPrimed) return notPrimed;
  const result = await accumulateItem({
    id: subject.row.id,
    itemKey: values.itemKey,
    payload: values.payload,
    metadata: values.metadata,
  }, ctx.auth);

  if (result.status !== 200) {
    if ((result.data as { outcome?: string } | undefined)?.outcome === 'duplicate-item') {
      return already(step, subject.row);
    }
    return failedAdd(step, ctx, result);
  }
  const data = result.data as { outcome: string; count: number; remaining: number | null };
  return withDone({
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.EXECUTED,
      verb: step.verb,
      escalation: { id: subject.row.id, ...result.data },
      clearSubject: data.outcome === 'completed',
    },
  }, step, bags(ctx));
}

/** The item is already where the scan says: harmless, nothing written. */
function already(step: ScanStep, row: LTEscalationRecord): ScanResult {
  return {
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.EXECUTED,
      verb: step.verb,
      escalation: { id: row.id },
      already: true,
      clearSubject: true,
    },
  };
}
