import { useAuth } from './useAuth';
import { getViewAs } from '../lib/view-as';

/**
 * Centralized dashboard access control.
 *
 * Derives visibility tiers from the authenticated user's roles and types,
 * then applies the active view-as override (if set via the settings panel).
 *
 * Tiers:
 * - **Builder**: superadmin or engineer — full dashboard (workflows, pipelines, MCP, admin)
 * - **Ops**: any role with admin type — escalations + user/role management (scoped)
 * - **Operator**: member type only — escalations only
 *
 * View-as overrides: an admin/superadmin/engineer can temporarily simulate a
 * lower role (admin → engineer → operator). The override is persisted in
 * localStorage and cleared by the settings panel's restore action.
 */
export function useAccess() {
  const { isSuperAdmin, hasRoleType, hasRole } = useAuth();
  const viewAs = getViewAs();

  const realIsBuilder = isSuperAdmin || hasRole('engineer');
  const realIsOps = hasRoleType('admin');
  const realCanBulk = isSuperAdmin || hasRoleType('admin');

  // When view-as is active, override access flags to simulate the target role.
  // admin/engineer views keep isOps=true so identity management (AdminSidebar)
  // remains visible; the ChoreographySidebar uses `viewAs` to distinguish
  // admin (pace board) vs engineer (work queue).
  const isBuilder = viewAs ? false : realIsBuilder;
  const isOps = viewAs ? (viewAs === 'admin' || viewAs === 'engineer') : realIsOps;
  const canBulk = viewAs ? false : realCanBulk;

  return { isBuilder, isOps, canBulk, viewAs, realIsBuilder };
}
