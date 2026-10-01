import { isSuperAdmin } from '../services/user';
import { isUuid } from '../lib/uuid';
import type { AuthPayload, CapabilityAccess, CapabilitySet, LTGrantRole } from '../types';

/**
 * Capability predicates shared by every entry point that faces people.
 *
 * Each predicate trusts the principal's `role` claim first and only then
 * consults the database. Lookup errors propagate so callers can deny.
 */

export type CapabilityPrincipal = Pick<AuthPayload, 'userId' | 'role'> & {
  /** Present for OAuth callers: the memberships the access token carries. */
  grantRoles?: LTGrantRole[];
};

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

const ALLOWED: GrantDecision = { allowed: true };

/** Whether `granterId` may assign every grant in a new account's role list. */
export async function mayGrantRoles(granterId: string, grants: RoleGrant[] | undefined): Promise<GrantDecision> {
  for (const grant of grants ?? []) {
    const decision = await mayGrantRole(granterId, grant);
    if (!decision.allowed) return decision;
  }
  return ALLOWED;
}

/**
 * Whether `callerId` may change, remove, or mint keys for an account. An
 * account holding superadmin is a superadmin's to manage; any other account
 * is left to the route's own gate.
 */
export async function mayManageAccount(callerId: string, targetId: string): Promise<GrantDecision> {
  if (await isSuperAdmin(callerId)) return ALLOWED;
  if (!isUuid(targetId)) return ALLOWED;
  if (await isSuperAdmin(targetId)) {
    return { allowed: false, error: 'Only superadmin can change a superadmin account' };
  }
  return ALLOWED;
}

/** Removing a role follows the grant rule for the role as the account holds it. */
export async function mayRevokeRole(callerId: string, targetId: string, role: string): Promise<GrantDecision> {
  const account = await mayManageAccount(callerId, targetId);
  if (!account.allowed || !isUuid(targetId)) return account;
  const { getUserRoles } = await import('../services/user');
  const held = (await getUserRoles(targetId)).find((r) => r.role === role);
  return held ? mayGrantRole(callerId, { role, type: held.type }) : ALLOWED;
}

/** Capabilities from memberships carried by the caller's token: the same outcomes, no lookup. */
function capabilitiesFromRoles(roles: LTGrantRole[]): CapabilitySet {
  const superadmin = roles.some((r) => r.type === 'superadmin');
  const admin = superadmin || roles.some((r) => r.type === 'admin');
  const engineer = roles.some((r) => r.role === BUILDER_ROLE);
  return { caller: true, admin, builder: superadmin || engineer, roleManager: admin || engineer, superadmin };
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
  if (principal.grantRoles) return capabilitiesFromRoles(principal.grantRoles);
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
