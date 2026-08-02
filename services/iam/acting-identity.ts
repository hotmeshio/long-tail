import * as userService from '../user';
import { exchangeEphemeralToken, parseEphemeralToken } from './ephemeral';
import { ACTING_IDENTITY_LABEL } from '../../types';
import type { LTApiAuth } from '../../types/sdk';

// ── Acting identity — the grant half of the shared-station pattern ─────────
//
// A badge scan mints an acting grant through the ephemeral keystore (see
// api/scan-codes/identity.ts). The grant rides requests — scan executes and
// the escalation work verbs alike — and this is the single place it turns
// back into a person: exchange, then run under THAT user's own live RBAC.
// The grant confers attribution, never privilege.

/** The acting-auth resolution result: an auth to act as, or the loud reason not to. */
export type ActingAuthResult =
  | { ok: true; auth: LTApiAuth }
  | { ok: false; error: string };

/**
 * Exchange a supplied acting grant for the person it names. A supplied token
 * that fails — wrong label, expired, exhausted, or a vanished user — is a
 * terminal error, never a silent fall-back to the session identity: that
 * would misattribute whatever follows.
 */
export async function resolveActingAuth(actingToken: string): Promise<ActingAuthResult> {
  const parsed = parseEphemeralToken(actingToken);
  if (!parsed || parsed.label !== ACTING_IDENTITY_LABEL) {
    return { ok: false, error: 'actingToken is not an acting-identity grant' };
  }
  const userId = await exchangeEphemeralToken(actingToken);
  if (!userId) {
    return { ok: false, error: 'acting identity expired — scan your badge again' };
  }
  const user = await userService.getUser(userId);
  if (!user || user.status !== 'active') {
    return { ok: false, error: 'acting identity is no longer an active user' };
  }
  return { ok: true, auth: { userId: user.id } };
}
