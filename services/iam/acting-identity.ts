import * as userService from '../user';
import { consumeEphemeral, parseEphemeralToken, peekEphemeral, refundEphemeral, type EphemeralGrant } from './ephemeral';
import { ACTING_IDENTITY_LABEL } from '../../types';
import type { LTApiAuth } from '../../types/sdk';

// ── Acting identity — the grant half of the shared-station pattern ─────────
//
// A badge scan mints an acting grant through the ephemeral keystore (see
// api/scan-codes/identity.ts). The grant rides requests — scan executes and
// the escalation work verbs alike — and this is the single place it turns
// back into a person: exchange, then run under THAT user's own live RBAC.
// The grant confers attribution, never privilege.
//
// Reading a grant (peek) never spends it; only an act does (consume). A scan
// that shows, holds, or refuses leaves the badge whole for the act after it.

/** What the client needs to know about a grant after a request touched it. */
export interface ActingGrantState {
  /** True when this request spent a use. */
  consumed: boolean;
  /** Uses left; null = bounded only by TTL (or bound to one subject). */
  remaining: number | null;
  /** True once the grant is bound to one subject. */
  bound: boolean;
}

/** The acting-auth resolution result: an auth to act as, or the loud reason not to. */
export type ActingAuthResult =
  | { ok: true; auth: LTApiAuth; grant: ActingGrantState }
  | { ok: false; error: string };

export const ACTING_ERRORS = {
  NOT_A_GRANT: 'actingToken is not an acting-identity grant',
  EXPIRED: 'acting identity expired — scan your badge again',
  INACTIVE: 'acting identity is no longer an active user',
  OTHER_SUBJECT: 'this badge already acted on another item; scan your badge again',
} as const;

function isActingGrant(actingToken: string): string | null {
  const parsed = parseEphemeralToken(actingToken);
  return parsed && parsed.label === ACTING_IDENTITY_LABEL ? parsed.uuid : null;
}

async function toAuth(
  grant: EphemeralGrant,
  consumed: boolean,
): Promise<ActingAuthResult> {
  const user = await userService.getUser(grant.value);
  if (!user || user.status !== 'active') return { ok: false, error: ACTING_ERRORS.INACTIVE };
  return {
    ok: true,
    auth: { userId: user.id },
    grant: { consumed, remaining: grant.remaining, bound: grant.bound },
  };
}

/**
 * Read a supplied acting grant without spending it. A token that fails
 * (wrong label, expired, exhausted, or a vanished user) is a terminal error,
 * never a silent fall-back to the session identity: that would misattribute
 * whatever follows.
 */
export async function peekActingAuth(actingToken: string): Promise<ActingAuthResult> {
  const uuid = isActingGrant(actingToken);
  if (!uuid) return { ok: false, error: ACTING_ERRORS.NOT_A_GRANT };
  const grant = await peekEphemeral(uuid);
  if (!grant) return { ok: false, error: ACTING_ERRORS.EXPIRED };
  return toAuth(grant, false);
}

/**
 * Spend one use of the grant for an act. `ref` names the subject the act
 * lands on; a subject-scoped grant binds to it on first spend.
 */
export async function consumeActingGrant(
  actingToken: string,
  ref: string | null = null,
): Promise<ActingAuthResult> {
  const uuid = isActingGrant(actingToken);
  if (!uuid) return { ok: false, error: ACTING_ERRORS.NOT_A_GRANT };
  const grant = await consumeEphemeral(uuid, ref);
  if (!grant) {
    const live = ref ? await peekEphemeral(uuid) : null;
    return { ok: false, error: live?.bound ? ACTING_ERRORS.OTHER_SUBJECT : ACTING_ERRORS.EXPIRED };
  }
  return toAuth(grant, true);
}

/** Return a use whose act missed. `unbind` when that spend bound the grant. */
export async function refundActingGrant(actingToken: string, unbind: boolean): Promise<void> {
  const uuid = isActingGrant(actingToken);
  if (uuid) await refundEphemeral(uuid, unbind);
}

/** Spend the grant up front: the escalation work routes always act. */
export async function resolveActingAuth(actingToken: string): Promise<ActingAuthResult> {
  return consumeActingGrant(actingToken);
}
