import * as roleService from '../../services/role';
import * as userService from '../../services/user';
import { readBadgeGrant } from '../../services/role/badge-grant';
import { SCAN_GRANT_SCOPES, type ScanGrantScope, type ScanScheme } from '../../types';

// ── The badge policy at a station ──────────────────────────────────────────
//
// One printed badge works at every bench, but benches want different
// policies: a workstation grants one act per badge scan, a binning bench ten
// minutes of acts. The policy therefore belongs to where the badge is
// scanned. A role may declare `properties.badge_grant`; a badge scanned on a
// device signed in as a member of that role mints under it. A device with
// several such roles names the one it is locked to (`stationRole`); with no
// role policy, or an unresolved choice between several, the badge scheme's
// own policy applies.

export interface GrantPolicy {
  ttlSeconds: number;
  maxUses: number;
  scope: ScanGrantScope;
  /** The station role whose policy applied; absent when the scheme's did. */
  role?: string;
}

function schemePolicy(scheme: ScanScheme): GrantPolicy {
  return {
    ttlSeconds: scheme.grant_ttl_seconds ?? 0,
    maxUses: scheme.grant_max_uses ?? 0,
    scope: scheme.grant_scope ?? SCAN_GRANT_SCOPES.ACTION,
  };
}

/** The policy a badge scanned on this device mints under. */
export async function stationGrantPolicy(
  scheme: ScanScheme,
  stationUserId: string,
  stationRole?: string,
): Promise<GrantPolicy> {
  const fallback = schemePolicy(scheme);
  const user = await userService.getUser(stationUserId);
  const memberRoles = (user?.roles ?? []).map((r) => r.role);
  const candidates = stationRole
    ? memberRoles.filter((r) => r === stationRole)
    : memberRoles;

  const declared: { role: string; grant: NonNullable<ReturnType<typeof readBadgeGrant>> }[] = [];
  for (const role of candidates) {
    const grant = readBadgeGrant(await roleService.getRoleProperties(role));
    if (grant) declared.push({ role, grant });
  }
  const distinct = new Set(declared.map((d) => JSON.stringify(d.grant)));
  if (distinct.size !== 1) return fallback;

  const { role, grant } = declared[0];
  return {
    ttlSeconds: grant.ttl_seconds ?? fallback.ttlSeconds,
    maxUses: grant.max_uses ?? fallback.maxUses,
    scope: grant.scope ?? fallback.scope,
    role,
  };
}
