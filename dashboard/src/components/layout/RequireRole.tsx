import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { LTRoleType } from '../../api/types';

interface RequireRoleProps {
  /** User must have at least one of these role types */
  roleTypes?: LTRoleType[];
  /** User must have at least one of these role names */
  roleNames?: string[];
  /** Where to redirect when unauthorized. Defaults to '/' */
  redirectTo?: string;
}

export function RequireRole({ roleTypes, roleNames, redirectTo = '/' }: RequireRoleProps) {
  const { isSuperAdmin, hasRole, hasRoleType } = useAuth();

  // Superadmin bypasses all role checks
  if (isSuperAdmin) return <Outlet />;

  // Check role types
  if (roleTypes && roleTypes.some((t) => hasRoleType(t))) return <Outlet />;

  // Check role names
  if (roleNames && roleNames.some((r) => hasRole(r))) return <Outlet />;

  return <Navigate to={redirectTo} replace />;
}
