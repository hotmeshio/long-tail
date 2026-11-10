import * as identifiers from '../services/identifiers';
import type { BindingQuery } from '../types/identifiers';
import type { LTApiAuth, LTApiResult } from '../types/sdk';

/** A refused binding request as an API result; anything else is a 500. */
function bindingFailure(err: any): LTApiResult {
  if (err instanceof identifiers.BindingError) return { status: err.status, error: err.message };
  return { status: 500, error: err?.message ?? 'binding request failed' };
}

/** The scheme, when the caller may bind under it; a refusal otherwise. */
async function asBinder(scheme: number, auth: LTApiAuth): Promise<LTApiResult | null> {
  const stored = await identifiers.bindingScheme(scheme);
  if (await identifiers.mayBind(auth, stored)) return null;
  return { status: 403, error: `binding under scheme ${scheme} takes a role manager or one of the scheme's binder roles` };
}

/**
 * List a scheme's bindings: live ones by default, newest first. `raw` finds
 * the live target of one scanned value.
 *
 * @returns `{ status: 200, data: { bindings } }`
 */
export async function listIdentifierBindings(input: { scheme: number } & BindingQuery): Promise<LTApiResult> {
  try {
    const { scheme, ...query } = input;
    await identifiers.bindingScheme(scheme);
    return { status: 200, data: { bindings: await identifiers.listBindings(scheme, query) } };
  } catch (err) {
    return bindingFailure(err);
  }
}

/**
 * Bind a scanned value to a target. 201 when bound, 200 when the pair already
 * stood, 409 when the value is bound to another target, 403 for a non-binder.
 */
export async function bindIdentifier(input: { scheme: number; raw: string; target: string }, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const refused = await asBinder(input.scheme, auth);
    if (refused) return refused;
    const result = await identifiers.bind(input.scheme, input.raw, input.target, { userId: auth.userId, via: identifiers.BOUND_VIA.API });
    return { status: result.already ? 200 : 201, data: result };
  } catch (err) {
    return bindingFailure(err);
  }
}

/** Move a scanned value to a new target, retiring its old binding in the same transaction. */
export async function rebindIdentifier(input: { scheme: number; raw: string; target: string }, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const refused = await asBinder(input.scheme, auth);
    if (refused) return refused;
    return { status: 200, data: await identifiers.rebind(input.scheme, input.raw, input.target, { userId: auth.userId, via: identifiers.BOUND_VIA.API }) };
  } catch (err) {
    return bindingFailure(err);
  }
}

/** Retire one live binding; it stays as history. 404 when it is not live. */
export async function retireIdentifierBinding(input: { scheme: number; id: string }, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const refused = await asBinder(input.scheme, auth);
    if (refused) return refused;
    const retired = await identifiers.retire(input.scheme, input.id, { userId: auth.userId, via: identifiers.BOUND_VIA.API });
    return retired ? { status: 200, data: retired } : { status: 404, error: 'No live binding with that id under this scheme' };
  } catch (err) {
    return bindingFailure(err);
  }
}
