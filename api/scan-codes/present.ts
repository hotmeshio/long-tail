import {
  SCAN_OUTCOMES,
  type ScanExecuteResponse,
  type ScanPresentedChoice,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { actingIdentitySatisfied } from './identity';
import { locateForStep } from './locate';
import { dispatchChoiceVerb } from './verbs';
import type { StepContext } from './context';

// ── The info-choice outcome — locate → present reality + labeled choices ───
//
// Some objects carry one code for their whole life: the next action cannot be
// inferred from state alone, and the system should not guess. A PRESENT step
// locates the row, states its reality, and returns the step's configured,
// labeled choice set — the same escalation primitives, presented instead of
// auto-executed. The human's tap (or a second scan matching a choice's code)
// is the disambiguator; execution goes back through /execute-choice, which
// re-validates everything.

/**
 * Locate the target and present the step's choices. Choices whose identity
 * requirement is unsatisfied come back withheld — the screen renders the
 * rule's "scan your badge" affordance beside them instead of a dead button.
 */
export async function presentStep(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const result = await locateForStep(step, ctx, 2);
  if (!result || result.escalations.length === 0) return null;
  const escalation = result.escalations[0];

  // One satisfaction test covers the step's scope; per-choice requirements
  // reuse it because a choice executes against the same step query.
  const satisfied = await actingIdentitySatisfied(step, ctx);

  // One scan, one action: a single confirm-less choice executes directly when
  // configured — presenting a one-button screen would be a pointless tap. An
  // unsatisfied identity requirement still presents (the client's badge
  // stop-over), never a silent or misattributed execution.
  const only = step.choices?.length === 1 ? step.choices[0] : undefined;
  const autoSelect = step.autoSelectSingle === true && only !== undefined && !only.confirm;
  if (autoSelect && (!only.requireActingIdentity || satisfied)) {
    return dispatchChoiceVerb(
      { query: step.query, verb: only.verb, params: only.params },
      ctx,
      escalation,
    );
  }

  const choices: ScanPresentedChoice[] = (step.choices ?? []).map((choice, index) => ({
    index,
    label: choice.label,
    verb: choice.verb,
    ...(choice.confirm ? { confirm: choice.confirm } : {}),
    ...(choice.requireActingIdentity ? { requireActingIdentity: true } : {}),
    ...(choice.code ? { code: choice.code } : {}),
    withheld: !!choice.requireActingIdentity && !satisfied,
  }));

  return {
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.CHOICES,
      verb: step.verb,
      escalation,
      choices,
      notPrimed: ctx.rule.notPrimed,
      ...(autoSelect ? { autoSelect: true } : {}),
    },
  };
}
