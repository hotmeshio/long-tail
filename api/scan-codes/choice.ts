import * as scanCodeService from '../../services/scan-code';
import * as escalationService from '../../services/escalation';
import {
  SCAN_OUTCOMES,
  SCAN_SCHEME_KINDS,
  SCAN_VERBS,
  type ScanChoiceExecuteRequest,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';
import { actingIdentitySatisfied } from './identity';
import { peekGrant, settleGrant } from './grant';
import { assertReadAccess } from '../escalations/helpers';
import { conflict, notPrimed, type StepContext } from './context';
import { locateForStep } from './locate';
import { dispatchChoiceVerb } from './verbs';

/**
 * Execute one presented choice. The request is a POINTER — scheme/category/
 * step/choice indices plus the escalation id the screen showed — and a
 * pointer is never authority: the choice is re-read from live config, the
 * row is re-located under the step's query, the identity gate re-applies,
 * and the verb runs through the same atomic executors a direct scan uses
 * (so a lost race is a structured CONFLICT, exactly as on double-scan).
 */
export async function executeScanChoice(
  input: ScanChoiceExecuteRequest,
  auth: LTApiAuth,
): Promise<LTApiResult<ScanExecuteResponse>> {
  try {
    if (!Number.isInteger(input?.schemeVersion) || typeof input?.category !== 'string'
      || !Number.isInteger(input?.stepIndex) || !Number.isInteger(input?.choiceIndex)
      || !input?.escalationId) {
      return { status: 400, error: 'schemeVersion, category, stepIndex, choiceIndex, and escalationId are required' };
    }

    // 1. The pointer resolves against LIVE config — an edit between render
    // and tap is a structured miss, never a stale execution.
    const scheme = await scanCodeService.getScanScheme(input.schemeVersion);
    const rule = await scanCodeService.getScanRule(input.schemeVersion, input.category);
    const step = rule?.steps?.[input.stepIndex];
    const choice = step?.choices?.[input.choiceIndex];
    if (!scheme || !scheme.enabled || scheme.kind !== SCAN_SCHEME_KINDS.ACTION
      || !rule || !rule.enabled || step?.verb !== SCAN_VERBS.PRESENT || !choice) {
      return {
        status: 200,
        data: { outcome: SCAN_OUTCOMES.UNCONFIGURED, error: 'the presented choice is no longer configured' },
      };
    }

    // 2. The acting grant, read (not spent) before anything reads or writes.
    let effectiveAuth = auth;
    let grant: StepContext['grant'];
    if (input.actingToken) {
      const peeked = await peekGrant(input.actingToken);
      if (!peeked.ok) {
        return {
          status: 200,
          data: { outcome: SCAN_OUTCOMES.NOT_PRIMED, notPrimed: rule.notPrimed, replayable: true, error: peeked.error },
        };
      }
      effectiveAuth = peeked.auth;
      grant = peeked.grant;
    }

    // 3. The row anchors the target: the scheme's facet on the escalation the
    // screen presented. A missing binding is loud misconfiguration.
    // A row the actor may not read answers exactly as a missing one does.
    const loaded = await escalationService.getEscalation(input.escalationId);
    const row = loaded && !(await assertReadAccess(effectiveAuth.userId, loaded)) ? loaded : null;
    const target = row?.metadata?.[scheme.target_facet];
    if (!row || typeof target !== 'string' || !target) {
      return {
        status: 200,
        data: { outcome: SCAN_OUTCOMES.UNCONFIGURED, error: `escalation does not carry the scheme facet "${scheme.target_facet}"` },
      };
    }

    const ctx: StepContext = {
      scheme,
      rule,
      parsed: { version: scheme.version, category: rule.category, target },
      scannedAt: new Date().toISOString(),
      auth: effectiveAuth,
      stationAuth: auth,
      acting: !!grant,
      grant,
    };

    // 4. The identity gate, per the choice.
    if (choice.requireActingIdentity && !(await actingIdentitySatisfied(step, ctx))) {
      return decorate(notPrimed(ctx), ctx, input);
    }

    // 5. The row must still match the step's query — the reality the screen
    // showed. A row that moved on (resolved, claimed away, re-routed) is the
    // same double-actor race a second scan loses.
    const located = await locateForStep(step, ctx, 2);
    const presented = located?.escalations.find((e) => e.id === input.escalationId);
    if (!presented) {
      return decorate(conflict('the item is no longer in the presented state'), ctx, input);
    }

    // 6. Dispatch through the same atomic executors a direct scan uses.
    const synthesized: ScanStep = { query: step.query, verb: choice.verb, params: choice.params };
    const result = decorate(await dispatchChoiceVerb(synthesized, ctx, presented), ctx, input);

    // 7. Settle the badge: refund a spend whose act did not land
    const acting = await settleGrant(ctx, result);
    if (acting && result.data) result.data = { ...result.data, acting };
    return result;
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Stamp the rule + pointer identity onto the outcome, mirroring execute. */
function decorate(
  result: LTApiResult<ScanExecuteResponse>,
  ctx: StepContext,
  input: ScanChoiceExecuteRequest,
): LTApiResult<ScanExecuteResponse> {
  if (result.data && typeof result.data === 'object' && 'outcome' in result.data) {
    result.data = {
      ...result.data,
      parsed: ctx.parsed,
      rule: { schemeVersion: ctx.rule.scheme_version, category: ctx.rule.category, name: ctx.rule.name },
      stepIndex: input.stepIndex,
    };
  }
  return result;
}
