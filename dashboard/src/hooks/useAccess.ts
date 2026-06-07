import { useAuth } from './useAuth';

/**
 * Centralized dashboard access control.
 *
 * Derives visibility tiers from the authenticated user's roles and types.
 * Every component that conditionally shows/hides UI uses this hook —
 * no inline role checks scattered across the codebase.
 *
 * Tiers:
 * - **Builder**: superadmin or engineer — full dashboard (workflows, pipelines, MCP, admin)
 * - **Ops**: any role with admin type — escalations + user/role management (scoped)
 * - **Operator**: member type only — escalations only
 */
export function useAccess() {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();

  /** Full dashboard access: workflows, pipelines, MCP, design, storage, admin */
  const isBuilder = isSuperAdmin || hasRole('engineer');

  /** Can manage users/roles (scoped to their roles unless superadmin/admin role) */
  const isOps = hasRoleType('admin');

  /** Can perform bulk escalation actions (claim, assign, triage, escalate) */
  const canBulk = isSuperAdmin || hasRoleType('admin');

  return { isBuilder, isOps, canBulk };
}
