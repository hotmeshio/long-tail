import * as userService from '../../services/user';
import {
  parseEphemeralToken,
  storeEphemeral,
  revokeEphemeral,
  formatEphemeralToken,
} from '../../services/iam/ephemeral';
import { restrictScopeRoles } from '../escalations/metadata';
import { getEscalationWriteScope } from '../escalations/helpers';
import {
  ACTING_IDENTITY_LABEL,
  SCAN_OUTCOMES,
  type ParsedScanCode,
  type ScanExecuteResponse,
  type ScanRule,
  type ScanScheme,
  type ScanStep,
} from '../../types';
import type { LTApiResult } from '../../types/sdk';
import type { StepContext } from './context';

export { resolveActingAuth, type ActingAuthResult } from '../../services/iam/acting-identity';

// ── Acting identity — the badge layer over the scan surface ────────────────
//
// A shared station device signs in as an ordinary read-capable account; the
// person supplies identity by scanning a badge under an identity-kind scheme.
// The badge token is an opaque printed credential resolved against a
// server-side binding (scheme.target_facet names the lt_users.metadata key it
// matches — never external_id, so a printed username can never impersonate).
// A match MINTS a grant through the ephemeral keystore: short-TTL, optionally
// n-use, useless unless exchanged server-side. The grant confers ATTRIBUTION,
// never privilege — verbs later run under the acting user's own live RBAC.

/**
 * Resolve an identity scan: badge → user → minted acting grant.
 * Identity schemes never walk steps; the rule's fallback is the
 * unknown-badge screen.
 */
export async function executeIdentityScan(
  parsed: ParsedScanCode,
  scheme: ScanScheme,
  rule: ScanRule,
  previousActingToken?: string,
): Promise<LTApiResult<ScanExecuteResponse>> {
  const user = await userService.getUserByMetadataValue(scheme.target_facet, parsed.target);
  if (!user) {
    return {
      status: 200,
      data: {
        outcome: SCAN_OUTCOMES.IDENTITY_UNKNOWN,
        parsed,
        rule: { schemeVersion: rule.scheme_version, category: rule.category, name: rule.name },
        fallback: rule.fallback,
        error: 'badge not recognized',
      },
    };
  }

  // The station is swapping people — the outgoing grant dies now, not at TTL.
  if (previousActingToken) {
    const prev = parseEphemeralToken(previousActingToken);
    if (prev && prev.label === ACTING_IDENTITY_LABEL) {
      await revokeEphemeral(prev.uuid).catch(() => { /* best effort; TTL is the guarantee */ });
    }
  }

  const uuid = await storeEphemeral(user.id, {
    ttlSeconds: scheme.grant_ttl_seconds ?? undefined,
    maxUses: scheme.grant_max_uses,
    label: ACTING_IDENTITY_LABEL,
  });
  const expiresAt = new Date(Date.now() + (scheme.grant_ttl_seconds ?? 0) * 1000).toISOString();
  return {
    status: 200,
    data: {
      outcome: SCAN_OUTCOMES.IDENTITY_PRIMED,
      parsed,
      rule: { schemeVersion: rule.scheme_version, category: rule.category, name: rule.name },
      actor: { id: user.id, displayName: user.display_name || user.external_id },
      actingToken: formatEphemeralToken(uuid, ACTING_IDENTITY_LABEL),
      expiresAt,
    },
  };
}

/**
 * The identity pre-condition's satisfaction test. A primed grant always
 * satisfies; without one, the authenticated user satisfies only when their
 * OWN write scope covers the step's roles — their login IS a person identity
 * with authority there. A write-incapable shared account can never
 * self-satisfy.
 */
export async function actingIdentitySatisfied(
  step: Pick<ScanStep, 'query'>,
  ctx: StepContext,
): Promise<boolean> {
  if (ctx.acting) return true;
  const scope = await getEscalationWriteScope(ctx.stationAuth.userId);
  if (scope.global) return true;
  const writable = [...scope.allRoles, ...scope.selfRoles];
  const roles = restrictScopeRoles(writable, scope.global, step.query?.roles);
  return roles === null || roles.length > 0;
}
