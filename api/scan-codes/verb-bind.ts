import * as identifiers from '../../services/identifiers';
import * as scanCodeService from '../../services/scan-code';
import { SCAN_OUTCOMES, type ScanExecuteResponse, type ScanStep } from '../../types';
import type { LTApiResult } from '../../types/sdk';
import { conflict, forbidden, refused, stepTemplate, withDone, type StepContext } from './context';
import { identityGate, spendGrant } from './grant';
import { bags, claimGuard, matchGuard, resolveHeld } from './verbs-subject';

type ScanResult = LTApiResult<ScanExecuteResponse>;

/**
 * Bind the scanned value to the held subject's target: the subject's scheme
 * target facet, or the facet the step names. The binding is kept under the
 * step's scheme, else the scanned code's. A value bound to another target is
 * refused, or moved here with `move`; the same pair again answers already.
 * With `resolve`, the held row is then resolved with the rendered payload.
 */
export async function bindStep(step: ScanStep, ctx: StepContext): Promise<ScanResult | null> {
  const subject = ctx.subject;
  if (!subject) return null;
  const claimed = await claimGuard(step, ctx, subject);
  if (claimed) return claimed;
  const mismatch = matchGuard(step, ctx, subject.row);
  if (mismatch) return mismatch;
  const options = step.params?.bind ?? {};

  // 1. The target the value is bound to, read from the held row
  const facet = options.facet ?? subject.scheme.target_facet;
  const target = (subject.row.metadata ?? {})[facet];
  if ((typeof target !== 'string' && typeof target !== 'number') || target === '') {
    return refused(`The held row carries no **${facet}** to bind to.`, { clearSubject: false });
  }

  // 2. The scheme and who may bind under it
  const notPrimed = await identityGate(step, ctx);
  if (notPrimed) return notPrimed;
  let scheme;
  try {
    scheme = await identifiers.bindingScheme(options.scheme ?? ctx.scheme.version);
  } catch (err) {
    if (err instanceof identifiers.BindingError) return conflict(err.message);
    throw err;
  }
  if (!(await identifiers.mayBind(ctx.auth, scheme))) {
    return refused(`Binding under **${scheme.name}** takes one of its binder roles.`, { clearSubject: false });
  }

  // 3. The resolve payload, rendered before anything is written
  let resolverPayload: Record<string, any> | undefined;
  if (options.resolve) {
    try {
      resolverPayload = scanCodeService.interpolateScanTemplate(options.resolve.payload ?? {}, await stepTemplate(step, ctx));
    } catch (err) {
      if (err instanceof scanCodeService.ScanTemplateError) return null;
      throw err;
    }
  }

  // 4. Spend the badge, then bind (or move)
  const unspent = await spendGrant(ctx);
  if (unspent) return unspent;
  const write = options.move ? identifiers.rebind : identifiers.bind;
  let result: identifiers.BindResult;
  try {
    result = await write(scheme.version, ctx.parsed.target, String(target), { userId: ctx.auth.userId, via: identifiers.BOUND_VIA.SCAN });
  } catch (err) {
    if (err instanceof identifiers.BindingError) return refused(err.status === 409 ? `**${ctx.parsed.target}** is already bound to something else.` : err.message, { clearSubject: false });
    throw err;
  }
  const { id, scheme_version, raw, target: bound } = result.binding;
  const binding = { id, scheme_version, raw, target: bound };

  // 5. Resolve the held row; the binding stands whatever the resolve answers
  let escalation: ScanExecuteResponse['escalation'] = { id: subject.row.id, role: subject.row.role };
  if (resolverPayload) {
    const resolved = await resolveHeld(ctx, subject, resolverPayload);
    if (resolved.status === 403) return forbidden(resolved.error);
    if (resolved.status === 409) return conflict(resolved.error);
    if (resolved.status === 400 || resolved.status === 422) return refused(resolved.error ?? 'the payload was not accepted', { binding, clearSubject: false });
    if (resolved.status === 200) escalation = resolved.data.escalation ?? { id: subject.row.id, role: subject.row.role, ...resolved.data };
    else if (resolved.status !== 404) return resolved;
  }

  // 6. Report
  return withDone({
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.EXECUTED,
      verb: step.verb,
      escalation,
      binding,
      ...(result.already ? { already: true } : {}),
      clearSubject: !!resolverPayload,
    },
  }, step, bags(ctx, subject.row));
}
