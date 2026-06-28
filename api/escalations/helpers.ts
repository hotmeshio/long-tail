import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { publishEscalationEvent } from '../../lib/events/publish';
import type { LTReadScope, LTRoleType, LTWriteScope } from '../../types';

// ── Private helpers ────────────────────────────────────────────────────────

// Re-export from service layer for use by escalation API modules
export { hasGlobalEscalationAccess } from '../../services/user';

/**
 * Read-scope partition for escalation search/list/stats. Splits the user's roles
 * into the breadth at which they may SEARCH:
 * - `global`   → sees every role's queue (superadmin, admin/admin); no role filter
 * - `allRoles` → roles where read_scope='all' (whole queue visible)
 * - `selfRoles`→ roles where read_scope='self' (only items assigned to them)
 *
 * The caller feeds allRoles + selfRoles + the user's id into the scoped search
 * predicate. `effectiveScope` folds admin/superadmin memberships to read='all'.
 */
export interface EscalationReadScope {
  global: boolean;
  allRoles: string[];
  selfRoles: string[];
}

export async function getEscalationReadScope(userId: string): Promise<EscalationReadScope> {
  if (await userService.hasGlobalEscalationAccess(userId)) {
    return { global: true, allRoles: [], selfRoles: [] };
  }
  const userRoles = await userService.getUserRoles(userId);
  const allRoles: string[] = [];
  const selfRoles: string[] = [];
  for (const r of userRoles) {
    const eff = userService.effectiveScope(r.type, r.read_scope, r.write_scope);
    if (eff.read === 'all') allRoles.push(r.role);
    else selfRoles.push(r.role);
  }
  return { global: false, allRoles, selfRoles };
}

export function validateIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0;
}

/**
 * Write-scope partition for metadata-driven resolve. Splits the user's roles by
 * the breadth at which they may ACT (claim/ack/delete):
 * - `global`   → may act on any role's queue; no filter
 * - `allRoles` → write_scope='all' (act on any item in the role)
 * - `selfRoles`→ write_scope='self' (act only on items assigned to them)
 * write_scope='none' roles are excluded — read-only memberships cannot act.
 */
export interface EscalationWriteScope {
  global: boolean;
  allRoles: string[];
  selfRoles: string[];
}

export async function getEscalationWriteScope(userId: string): Promise<EscalationWriteScope> {
  if (await userService.hasGlobalEscalationAccess(userId)) {
    return { global: true, allRoles: [], selfRoles: [] };
  }
  const userRoles = await userService.getUserRoles(userId);
  const allRoles: string[] = [];
  const selfRoles: string[] = [];
  for (const r of userRoles) {
    const eff = userService.effectiveScope(r.type, r.read_scope, r.write_scope);
    if (eff.write === 'all') allRoles.push(r.role);
    else if (eff.write === 'self') selfRoles.push(r.role);
  }
  return { global: false, allRoles, selfRoles };
}

/**
 * Authorize a READ of one escalation (get single). Global access sees all;
 * otherwise the user must hold the role with read_scope='all', OR read_scope='self'
 * with the escalation assigned to them. Returns an error result, or null if allowed.
 */
export async function assertReadAccess(
  userId: string,
  escalation: { role: string; assigned_to?: string | null },
): Promise<{ status: number; error: string } | null> {
  if (await userService.hasGlobalEscalationAccess(userId)) return null;
  const scope = await userService.getRoleScope(userId, escalation.role);
  if (!scope) return { status: 403, error: 'Not authorized to view this escalation' };
  if (scope.read === 'all') return null;
  if (escalation.assigned_to && escalation.assigned_to === userId) return null;
  return { status: 403, error: 'Not authorized to view this escalation' };
}

/**
 * Authorize a WRITE on one escalation (claim/ack/delete by id). Global access may
 * act on all; otherwise write_scope='all' may act on any item in the role, and
 * write_scope='self' may act only on items assigned to the user. read-only
 * ('none') and non-members are denied. Returns an error result, or null if allowed.
 *
 * This is an authorization gate over durable ownership (a self-scope user cannot
 * reassign items to themselves), so the subsequent atomic mutation is the single
 * source of truth — no claim race is introduced here.
 */
export async function assertWriteAccess(
  userId: string,
  escalation: { role: string; assigned_to?: string | null },
): Promise<{ status: number; error: string } | null> {
  if (await userService.hasGlobalEscalationAccess(userId)) return null;
  const scope = await userService.getRoleScope(userId, escalation.role);
  const write = scope ? scope.write : 'none';
  if (write === 'all') return null;
  if (write === 'self') {
    if (escalation.assigned_to && escalation.assigned_to === userId) return null;
    return {
      status: 403,
      error: `You may only act on escalations assigned to you in the "${escalation.role}" role`,
    };
  }
  return { status: 403, error: `You do not have write access to the "${escalation.role}" role` };
}

/**
 * Require write_scope='all' (or global) for a queue-management verb — release and
 * escalate move an item out of the user's hands, so self-scope owners (who only
 * fill in their own item) and read-only members may not perform them.
 */
export async function assertQueueManageAccess(
  userId: string,
  role: string,
): Promise<{ status: number; error: string } | null> {
  if (await userService.hasGlobalEscalationAccess(userId)) return null;
  const scope = await userService.getRoleScope(userId, role);
  if (scope && scope.write === 'all') return null;
  return { status: 403, error: `You do not have permission to manage the "${role}" queue` };
}

export async function checkBulkPermission(
  userId: string,
  ids: string[],
): Promise<{ allowed: true } | { allowed: false; status: 403; error: string }> {
  if (await userService.hasGlobalEscalationAccess(userId)) return { allowed: true };

  const roles = await escalationService.getEscalationRoles(ids);
  if (!roles.length) return { allowed: true };

  // Single batched query instead of N+1 loop
  const canManageAll = await userService.hasRolesAsAdmin(userId, roles);
  if (!canManageAll) {
    return { allowed: false, status: 403, error: 'Insufficient permissions for one or more escalation roles' };
  }
  return { allowed: true };
}

/**
 * Identity to provision when the assignee doesn't exist in lt_users
 * or lacks the required role. Only honored for callers with global
 * escalation access (superadmin, admin/admin).
 */
export interface ProvisionIfAbsent {
  displayName?: string;
  email?: string;
  roles?: Array<{ role: string; type?: string; read_scope?: string; write_scope?: string }>;
}

/**
 * Resolve an optional assignee external_id to an internal userId.
 * When omitted, returns the caller's userId from auth.
 *
 * When `provisionIfAbsent` is provided and the caller has global access,
 * the user is JIT-provisioned if absent and roles are ensured. This avoids
 * pre-flight queries — the happy path (user exists) is one lookup.
 */
export async function resolveAssignee(
  assignee: string | undefined,
  auth: { userId: string },
  provisionIfAbsent?: ProvisionIfAbsent,
): Promise<{ userId: string } | { error: { status: number; error: string } }> {
  if (!assignee) return { userId: auth.userId };

  // Happy path: user exists
  const user = await userService.getUserByExternalId(assignee);
  if (user) return { userId: user.id };

  // User not found — provision if caller has authority and flag is set
  if (!provisionIfAbsent) {
    return { error: { status: 404, error: `User not found for external_id: ${assignee}` } };
  }

  const hasAuthority = await userService.hasGlobalEscalationAccess(auth.userId);
  if (!hasAuthority) {
    return { error: { status: 403, error: 'Only superadmin or admin can provision users on claim' } };
  }

  // Provision the user. The onboarding/customer flow declares the work-surface
  // scope (e.g. read_self + write_self) so the provisioned user sees and acts on
  // only their own pre-claimed item.
  const created = await userService.createUser({
    external_id: assignee,
    display_name: provisionIfAbsent.displayName || assignee,
    email: provisionIfAbsent.email,
    roles: (provisionIfAbsent.roles || []).map((r) => ({
      role: r.role,
      type: (r.type || 'member') as LTRoleType,
      read_scope: r.read_scope as LTReadScope | undefined,
      write_scope: r.write_scope as LTWriteScope | undefined,
    })),
  });

  return { userId: created.id };
}

/**
 * Ensure a user has the required role for an escalation.
 * Called after claim when the atomic SQL returns null due to role mismatch.
 * Only adds the role if `provisionIfAbsent` declares it and caller has authority.
 */
export async function ensureRoleMembership(
  userId: string,
  requiredRole: string,
  callerUserId: string,
  provisionIfAbsent?: ProvisionIfAbsent,
): Promise<boolean> {
  if (!provisionIfAbsent) return false;

  const hasAuthority = await userService.hasGlobalEscalationAccess(callerUserId);
  if (!hasAuthority) return false;

  // Check if the provision declares this role
  const declaredRole = provisionIfAbsent.roles?.find((r) => r.role === requiredRole);
  if (!declaredRole) return false;

  // Add the role — idempotent (ON CONFLICT DO NOTHING)
  try {
    await userService.addUserRole(
      userId,
      requiredRole,
      (declaredRole.type || 'member') as LTRoleType,
      {
        read_scope: declaredRole.read_scope as LTReadScope | undefined,
        write_scope: declaredRole.write_scope as LTWriteScope | undefined,
      },
    );
  } catch { /* already has it */ }
  return true;
}

export function publishBulkClaimEvents(ids: string[], assignedTo: string): void {
  for (const id of ids) {
    publishEscalationEvent({
      type: 'escalation.claimed',
      source: 'api',
      workflowId: '',
      workflowName: '',
      taskQueue: '',
      escalationId: id,
      status: 'claimed',
      data: { assigned_to: assignedTo, bulk: true },
    });
  }
}
