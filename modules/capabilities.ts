import { isSuperAdmin } from '../services/user';
import type { AuthPayload, CapabilityAccess, CapabilitySet } from '../types';

/**
 * Capability predicates shared by every entry point that faces people.
 *
 * Each predicate trusts the principal's `role` claim first and only then
 * consults the database. Lookup errors propagate so callers can deny.
 */

export type CapabilityPrincipal = Pick<AuthPayload, 'userId' | 'role'>;

export interface RoleGrant {
  role: string;
  type?: string;
}

export type GrantDecision = { allowed: true } | { allowed: false; error: string };

const BUILDER_ROLE = 'engineer';

async function hasBuilderRole(userId: string): Promise<boolean> {
  const { hasRole } = await import('../services/user/roles');
  return hasRole(userId, BUILDER_ROLE);
}

/** Admin or superadmin claim, or a superadmin in the database. */
export async function mayAdminister(principal: CapabilityPrincipal | undefined): Promise<boolean> {
  if (!principal?.userId) return false;
  if (principal.role === 'admin' || principal.role === 'superadmin') return true;
  return isSuperAdmin(principal.userId);
}

/** Superadmin (claim or database), or holder of the engineer role. */
export async function mayBuild(principal: CapabilityPrincipal | undefined): Promise<boolean> {
  if (!principal?.userId) return false;
  if (principal.role === 'superadmin') return true;
  if (await isSuperAdmin(principal.userId)) return true;
  return hasBuilderRole(principal.userId);
}

/** Anyone who may administer, plus holders of the engineer role. */
export async function mayManageRoles(principal: CapabilityPrincipal | undefined): Promise<boolean> {
  if (!principal?.userId) return false;
  if (await mayAdminister(principal)) return true;
  return hasBuilderRole(principal.userId);
}

/**
 * Whether `granterId` may assign `grant` to a user.
 *
 * - superadmin: any role and type
 * - engineer: any role, never the superadmin type
 * - anyone else: only roles they hold, never the superadmin type
 */
export async function mayGrantRole(granterId: string, grant: RoleGrant): Promise<GrantDecision> {
  if (await isSuperAdmin(granterId)) return { allowed: true };
  if (grant.type === 'superadmin') {
    return { allowed: false, error: 'Only superadmin can assign superadmin role type' };
  }
  if (await hasBuilderRole(granterId)) return { allowed: true };
  const { hasRole } = await import('../services/user/roles');
  if (await hasRole(granterId, grant.role)) return { allowed: true };
  return { allowed: false, error: `You can only assign roles you hold. You do not have the '${grant.role}' role.` };
}

const NO_CAPABILITIES: CapabilitySet = {
  caller: false, admin: false, builder: false, roleManager: false, superadmin: false,
};

/**
 * Every capability the principal holds, with the same outcomes as the
 * predicates above. A superadmin claim costs no lookup; anyone else costs
 * at most one superadmin lookup and one engineer-role lookup.
 */
export async function resolveCapabilities(principal: CapabilityPrincipal | undefined): Promise<CapabilitySet> {
  if (!principal?.userId) return NO_CAPABILITIES;
  if (principal.role === 'superadmin' || (await isSuperAdmin(principal.userId))) {
    return { caller: true, admin: true, builder: true, roleManager: true, superadmin: true };
  }
  const admin = principal.role === 'admin';
  const engineer = await hasBuilderRole(principal.userId);
  return { caller: true, admin, builder: engineer, roleManager: admin || engineer, superadmin: false };
}

/**
 * Capability checks for one request. `caller` needs only an authenticated
 * principal; any other gate resolves the principal's capabilities once, on
 * first need, so a request that checks only `caller` gates makes no lookup.
 */
export function capabilityAccess(principal: CapabilityPrincipal | undefined): CapabilityAccess {
  let resolved: Promise<CapabilitySet> | undefined;
  return async (gate) => {
    if (!principal?.userId) return false;
    if (gate === 'caller') return true;
    resolved ??= resolveCapabilities(principal);
    return (await resolved)[gate];
  };
}
