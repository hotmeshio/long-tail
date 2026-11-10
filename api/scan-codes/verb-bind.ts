import * as identifiers from '../../services/identifiers';
import { SCAN_OUTCOMES, type ScanExecuteResponse, type ScanStep } from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { conflict, refused, withDone, type StepContext } from './context';
import { identityGate, spendGrant } from './grant';
import { bags, claimGuard, matchGuard } from './verbs-subject';

type ScanResult = LTApiResult<ScanExecuteResponse>;

/**
 * Bind the scanned value to the held subject's target: the subject's scheme
 * target facet, or the facet the step names. The binding is kept under the
 * step's scheme, else the scanned code's. A value bound to another target is
 * refused; the same pair again answers already.
 */
export async function bindStep(step: ScanStep, ctx: StepContext): Promise<ScanResult | null> {
  const subject = ctx.subject;
  if (!subject) return null;
  const claimed = await claimGuard(step, ctx, subject);
  if (claimed) return claimed;
  const mismatch = matchGuard(step, ctx, subject.row);
  if (mismatch) return mismatch;

  // 1. The target the value is bound to, read from the held row
  const facet = step.params?.bind?.facet ?? subject.scheme.target_facet;
  const target = (subject.row.metadata ?? {})[facet];
  if ((typeof target !== 'string' && typeof target !== 'number') || target === '') {
    return refused(`The held row carries no **${facet}** to bind to.`, { clearSubject: false });
  }

  // 2. The scheme and who may bind under it
  const notPrimed = await identityGate(step, ctx);
  if (notPrimed) return notPrimed;
  let scheme;
  try {
    scheme = await identifiers.bindingScheme(step.params?.bind?.scheme ?? ctx.scheme.version);
  } catch (err) {
    if (err instanceof identifiers.BindingError) return conflict(err.message);
    throw err;
  }
  if (!(await identifiers.mayBind(ctx.auth, scheme))) {
    return refused(`Binding under **${scheme.name}** takes one of its binder roles.`, { clearSubject: false });
  }

  // 3. Spend the badge, then bind
  const unspent = await spendGrant(ctx);
  if (unspent) return unspent;
  let result: identifiers.BindResult;
  try {
    result = await identifiers.bind(scheme.version, ctx.parsed.target, String(target), { userId: ctx.auth.userId, via: identifiers.BOUND_VIA.SCAN });
  } catch (err) {
    if (err instanceof identifiers.BindingError) return refused(err.status === 409 ? `**${ctx.parsed.target}** is already bound to something else.` : err.message, { clearSubject: false });
    throw err;
  }

  // 4. Report
  const { id, scheme_version, raw, target: bound } = result.binding;
  return withDone({
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.EXECUTED,
      verb: step.verb,
      escalation: { id: subject.row.id, role: subject.row.role },
      binding: { id, scheme_version, raw, target: bound },
      ...(result.already ? { already: true } : {}),
      clearSubject: false,
    },
  }, step, bags(ctx, subject.row));
}
