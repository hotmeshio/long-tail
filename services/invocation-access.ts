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

/** The workflow that calls a named MCP tool with lt-system authority. */
export const CAPABILITY_INVOKE_WORKFLOW = 'capabilityInvoke';

/**
 * Workflows whose activities act with lt-system authority. Started from
 * outside the process, they would lend that authority to the caller, so only
 * a superadmin may start one. Internal starts (agent triggers) are unaffected.
 */
export const SYSTEM_AUTHORITY_WORKFLOWS: ReadonlySet<string> = new Set([CAPABILITY_INVOKE_WORKFLOW]);

const ROLE_TYPE_RANK: Record<string, number> = { member: 1, admin: 2, superadmin: 3 };

function holdsSuperadmin(roles: readonly InvocationRoleGrant[]): boolean {
  return roles.some((r) => r.type === INVOCATION_ROLE_TYPES.SUPERADMIN);
}

/**
 * Whether a caller may run a workflow as another principal. A superadmin may
 * act as anyone. Otherwise the caller needs an admin-type grant, the target
 * holds no superadmin grant, and every grant the target holds the caller
 * holds at the same or a higher type: an override never exceeds the caller.
 */
export function mayActAs(caller: readonly InvocationRoleGrant[], target: readonly InvocationRoleGrant[]): boolean {
  if (holdsSuperadmin(caller)) return true;
  if (!caller.some((r) => r.type === INVOCATION_ROLE_TYPES.ADMIN)) return false;
  if (holdsSuperadmin(target)) return false;
  return target.every((t) => caller.some(
    (c) => c.role === t.role && (ROLE_TYPE_RANK[c.type] ?? 0) >= (ROLE_TYPE_RANK[t.type] ?? 0),
  ));
}

/** Superadmin anywhere, or the named admin role held as admin type, invokes every workflow. */
export function hasGlobalInvocationAccess(roles: readonly InvocationRoleGrant[], authRole?: string): boolean {
  if (authRole === INVOCATION_ROLE_TYPES.SUPERADMIN) return true;
  return roles.some((r) => r.type === INVOCATION_ROLE_TYPES.SUPERADMIN)
    || roles.some((r) => r.role === ADMIN_ROLE && r.type === INVOCATION_ROLE_TYPES.ADMIN);
}

/**
 * The one invocation predicate, shared by the invoke gate and the per-caller
 * list so the two can never disagree. An empty invocation_roles list opens
 * the workflow to every authenticated caller. A system-authority workflow
 * needs a superadmin grant, whatever its stored roles say.
 */
export function canInvokeWorkflow(
  config: Pick<LTWorkflowConfig, 'invocable' | 'invocation_roles'> & { workflow_type?: string },
  roles: readonly InvocationRoleGrant[],
  authRole?: string,
): boolean {
  if (!config.invocable) return false;
  if (config.workflow_type && SYSTEM_AUTHORITY_WORKFLOWS.has(config.workflow_type)) return holdsSuperadmin(roles);
  if (config.invocation_roles.length === 0) return true;
  if (hasGlobalInvocationAccess(roles, authRole)) return true;
  const held = new Set(roles.map((r) => r.role));
  return config.invocation_roles.some((r) => held.has(r));
}
