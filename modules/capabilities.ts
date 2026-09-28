import { isSuperAdmin } from '../services/user';
import type { AuthPayload } from '../types';

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
