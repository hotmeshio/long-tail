import * as scanCodeService from '../../services/scan-code';
import { actingIdentitySatisfied, executeIdentityScan } from './identity';
import { notPrimed, templateContext, withDone, type StepContext } from './context';
import { peekGrant, settleGrant } from './grant';
import { holdStep } from './hold';
import { locateStep } from './locate';
import { presentStep } from './present';
import { resolveSubject } from './subject';
import { fillStep } from './verb-fill';
import { accumulateStep, cancelStep, claimStep, escalateStep, releaseStep, resolveStep } from './verbs';
import {
  SCAN_OUTCOMES,
  SCAN_SCHEME_KINDS,
  SCAN_VERBS,
  type ScanExecuteRequest,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

export type { StepContext } from './context';

const SUBJECT_STALE_MESSAGE = 'That one moved on. Scan it again.';

/**
 * Execute a raw scan code: parse → load the rule → walk its steps in order.
 * The first step whose condition matches performs its verb and answers; a
 * step that matches nothing falls through to the next. Every terminal state
 * is a structured 200 outcome — the scan surface reports, it doesn't throw.
 */
export async function executeScanCode(
  input: ScanExecuteRequest,
  auth: LTApiAuth,
): Promise<LTApiResult<ScanExecuteResponse>> {
  try {
    if (!input.code || typeof input.code !== 'string') {
      return { status: 400, error: 'code is required' };
    }

    // 1. Parse against the configured schemes
    const schemes = await scanCodeService.listScanSchemes();
    const parseResult = scanCodeService.parseScanCode(input.code, schemes);
    if (!parseResult.ok) {
      const { reason, detail } = parseResult.failure;
      const outcome = reason === 'unknown_version' || reason === 'scheme_disabled'
        ? SCAN_OUTCOMES.UNCONFIGURED
        : SCAN_OUTCOMES.INVALID_CODE;
      return { status: 200, data: { outcome, error: detail } };
    }
    const { parsed, scheme } = parseResult;

    // 2. Load the rule for this category
    const rule = await scanCodeService.getScanRule(parsed.version, parsed.category);
    if (!rule || !rule.enabled) {
      return {
        status: 200,
        data: {
          outcome: SCAN_OUTCOMES.UNCONFIGURED,
          parsed,
          error: `no scan rule configured for ${parsed.version}:${parsed.category}`,
        },
      };
    }

    // 2a. Identity schemes are the badge layer — they mint, never walk steps.
    if (scheme.kind === SCAN_SCHEME_KINDS.IDENTITY) {
      return executeIdentityScan(parsed, scheme, rule, input.previousActingToken, {
        userId: auth.userId,
        stationRole: typeof input.stationRole === 'string' ? input.stationRole : undefined,
      });
    }

    // 2b. A supplied acting grant is read up front (not spent): the acting
    // user's read scope governs the locate as much as the mutation. A dead
    // grant terminates loudly; silently degrading to the station identity
    // would misattribute whatever follows.
    const ctx: StepContext = {
      scheme, rule, parsed, rawCode: input.code.trim(), scannedAt: new Date().toISOString(),
      auth, stationAuth: auth, acting: false,
    };
    if (input.actingToken) {
      const peeked = await peekGrant(input.actingToken);
      if (!peeked.ok) {
        return { status: 200, data: { ...notPrimed(ctx, peeked.error).data!, parsed } };
      }
      ctx.auth = peeked.auth;
      ctx.acting = true;
      ctx.grant = peeked.grant;
    }

    // 2c. The held subject, re-derived from the station's pointer
    const held = await resolveSubject(input.subject, schemes, auth);
    if (held?.ok) ctx.subject = held.subject;
    else if (held) ctx.subjectStale = true;

    // 3. Walk the steps — first condition match wins
    let result: LTApiResult<ScanExecuteResponse> | null = null;
    for (let i = 0; i < rule.steps.length && !result; i++) {
      const stepResult = await executeStep(rule.steps[i], ctx);
      if (stepResult) result = decorate(withDone(stepResult, rule.steps[i], templateContext(ctx)), ctx, i);
    }

    // 4. Nothing matched: a stale subject, or the fallback screen
    if (!result) {
      result = ctx.subjectStale
        ? { status: 200, data: decorateData({ outcome: SCAN_OUTCOMES.SUBJECT_STALE, clearSubject: true, error: SUBJECT_STALE_MESSAGE }, ctx) }
        : { status: 200, data: decorateData({ outcome: SCAN_OUTCOMES.NO_MATCH_FALLBACK, fallback: rule.fallback }, ctx) };
    }

    // 5. Settle the badge: refund a spend whose act did not land
    const acting = await settleGrant(ctx, result);
    if (result.data && typeof result.data === 'object' && 'outcome' in result.data) {
      result.data = {
        ...result.data,
        ...(acting ? { acting } : {}),
        ...(ctx.subjectStale ? { clearSubject: true } : {}),
      };
    }
    return result;
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Stamp rule identity + parsed code onto a step result. */
function decorate(
  result: LTApiResult<ScanExecuteResponse>,
  ctx: StepContext,
  stepIndex: number,
): LTApiResult<ScanExecuteResponse> {
  if (result.data && typeof result.data === 'object' && 'outcome' in result.data) {
    result.data = { ...decorateData(result.data, ctx), stepIndex };
  }
  return result;
}

function decorateData(data: ScanExecuteResponse, ctx: StepContext): ScanExecuteResponse {
  return {
    ...data,
    parsed: ctx.parsed,
    rule: {
      schemeVersion: ctx.rule.scheme_version,
      category: ctx.rule.category,
      name: ctx.rule.name,
    },
  };
}

/**
 * A subject step runs only while a subject from one of its schemes is held,
 * and, when it declares facets, only while the held row carries them.
 */
function subjectGateOpen(step: ScanStep, ctx: StepContext): boolean {
  if (!step.subject) return true;
  if (!ctx.subject || !step.subject.schemes.includes(ctx.subject.scheme.version)) return false;
  const meta = (ctx.subject.row.metadata ?? {}) as Record<string, unknown>;
  return Object.entries(step.subject.facets ?? {}).every(([key, value]) => meta[key] === value);
}

/**
 * Execute one step. Returns null when the step's condition matched nothing
 * (fall through) and an LTApiResult for every terminal outcome.
 */
async function executeStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  if (!subjectGateOpen(step, ctx)) return null;
  // The identity pre-condition: the effective actor must be a real acting
  // identity — a badge grant, or an authenticated user whose own write scope
  // covers the step. A write-incapable shared account can never self-satisfy,
  // so the outcome is the rule's "scan your badge" screen, never a silent or
  // misattributed action.
  // A subject step checks the pairing first and asks for the badge only when
  // the pairing is right (see identityGate), so a wrong container is named
  // at once.
  if (step.requireActingIdentity && !step.subject && !(await actingIdentitySatisfied(step, ctx))) {
    return notPrimed(ctx);
  }
  // Confirm steps and read verbs only locate — mutation happens after the
  // user confirms, through the standard per-id endpoints.
  if (step.confirm || step.verb === SCAN_VERBS.SHOW_DETAIL || step.verb === SCAN_VERBS.SHOW_LIST) {
    return locateStep(step, ctx);
  }
  switch (step.verb) {
    case SCAN_VERBS.PRESENT:
      return presentStep(step, ctx);
    case SCAN_VERBS.HOLD:
      return holdStep(step, ctx);
    case SCAN_VERBS.CLAIM:
    case SCAN_VERBS.CLAIM_SHOW_DETAIL:
      return claimStep(step, ctx);
    case SCAN_VERBS.RESOLVE:
      return resolveStep(step, ctx);
    case SCAN_VERBS.ESCALATE:
      return escalateStep(step, ctx);
    case SCAN_VERBS.RELEASE:
      return releaseStep(step, ctx);
    case SCAN_VERBS.CANCEL:
      return cancelStep(step, ctx);
    case SCAN_VERBS.ACCUMULATE:
      return accumulateStep(step, ctx);
    case SCAN_VERBS.FILL:
      return fillStep(step, ctx);
    default:
      throw new Error(`unknown scan verb "${step.verb}"`);
  }
}
