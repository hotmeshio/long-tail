import { consumeActingGrant, peekActingAuth, refundActingGrant } from '../../services/iam/acting-identity';
import {
  SCAN_MUTATING_VERBS,
  SCAN_OUTCOMES,
  type ScanExecuteResponse,
  type ScanStep,
} from '../../types';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';
import { notPrimed, type GrantLedger, type StepContext } from './context';
import { actingIdentitySatisfied } from './identity';

// ── The badge is spent by acts, not by looking ──────────────────────────────
//
// A grant riding a scan is read up front (peek) so the badged person's scope
// governs the locate. A use is spent only when a mutating verb is about to
// write, at most once per request, and refunded when that write misses: a
// scan that shows, holds, or refuses leaves the badge whole.

export type PeekResult =
  | { ok: true; auth: LTApiAuth; grant: GrantLedger }
  | { ok: false; error: string };

/** Read the grant without spending it. */
export async function peekGrant(token: string): Promise<PeekResult> {
  const peeked = await peekActingAuth(token);
  if (!peeked.ok) return peeked;
  return {
    ok: true,
    auth: peeked.auth,
    grant: { token, peeked: { remaining: peeked.grant.remaining, bound: peeked.grant.bound }, spent: null },
  };
}

/**
 * Spend the request's grant before a write. Returns null when the act may
 * proceed (spent now, spent earlier in this request, or no grant rides it),
 * and the not-primed result when the grant cannot cover this act. `ref` is
 * the held subject the act lands on.
 */
export async function spendGrant(
  ctx: StepContext,
  ref: string | null = ctx.subject?.row.id ?? null,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  const grant = ctx.grant;
  if (!grant || grant.spent) return null;
  const consumed = await consumeActingGrant(grant.token, ref);
  if (!consumed.ok) return notPrimed(ctx, consumed.error);
  grant.spent = { remaining: consumed.grant.remaining, bound: consumed.grant.bound };
  return null;
}

/** The step's identity requirement, checked at the moment it is about to act. */
export async function identityGate(
  step: ScanStep,
  ctx: StepContext,
): Promise<LTApiResult<ScanExecuteResponse> | null> {
  if (!step.requireActingIdentity || (await actingIdentitySatisfied(step, ctx))) return null;
  return notPrimed(ctx);
}

/** True when the result is a write that landed. */
function landed(result: LTApiResult<ScanExecuteResponse> | null): boolean {
  const data = result?.data;
  return !!data && data.outcome === SCAN_OUTCOMES.EXECUTED
    && !!data.verb && SCAN_MUTATING_VERBS.includes(data.verb) && !data.already;
}

/**
 * Close the request's books on the grant: refund a spend whose act did not
 * land, and report the grant's state for the client to keep or retire.
 */
export async function settleGrant(
  ctx: StepContext,
  result: LTApiResult<ScanExecuteResponse> | null,
): Promise<ScanExecuteResponse['acting'] | undefined> {
  const grant = ctx.grant;
  if (!grant) return undefined;
  if (grant.spent && !landed(result)) {
    // Spending a bound grant cost nothing; spending an unbound one counted
    // a use and may have bound it, so both come back.
    if (!grant.peeked.bound) await refundActingGrant(grant.token, grant.spent.bound);
    grant.spent = null;
  }
  const state = grant.spent ?? grant.peeked;
  return { consumed: !!grant.spent, remaining: state.remaining, bound: state.bound };
}
