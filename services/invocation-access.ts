import type { LTWorkflowConfig } from '../types/config';

export interface InvocationRoleGrant {
  role: string;
  type: string;
}

export const INVOCATION_ROLE_TYPES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
} as const;

export const ADMIN_ROLE = 'admin';

/** Superadmin anywhere, or the named admin role held as admin type, invokes every workflow. */
export function hasGlobalInvocationAccess(roles: readonly InvocationRoleGrant[], authRole?: string): boolean {
  if (authRole === INVOCATION_ROLE_TYPES.SUPERADMIN) return true;
  return roles.some((r) => r.type === INVOCATION_ROLE_TYPES.SUPERADMIN)
    || roles.some((r) => r.role === ADMIN_ROLE && r.type === INVOCATION_ROLE_TYPES.ADMIN);
}

/**
 * The one invocation predicate, shared by the invoke gate and the per-caller
 * list so the two can never disagree. An empty invocation_roles list opens
 * the workflow to every authenticated caller.
 */
export function canInvokeWorkflow(
  config: Pick<LTWorkflowConfig, 'invocable' | 'invocation_roles'>,
  roles: readonly InvocationRoleGrant[],
  authRole?: string,
): boolean {
  if (!config.invocable) return false;
  if (config.invocation_roles.length === 0) return true;
  if (hasGlobalInvocationAccess(roles, authRole)) return true;
  const held = new Set(roles.map((r) => r.role));
  return config.invocation_roles.some((r) => held.has(r));
}
