import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { escalationPattern } from '../lib/events/subjects';

/**
 * The escalation subject patterns that can affect the viewing user: one
 * role-scoped pattern per member role. Global viewers (superadmin, admin)
 * span every queue, so they get the family-wide pattern.
 */
export function useMemberEscalationPatterns(): string[] {
  const { user, isSuperAdmin, hasRoleType } = useAuth();
  const isGlobal = isSuperAdmin || hasRoleType('admin');
  const rolesKey = (user?.roles ?? []).map((r) => r.role).sort().join(',');

  return useMemo(() => {
    if (isGlobal || !rolesKey) return [escalationPattern({})];
    return rolesKey.split(',').map((role) => escalationPattern({ role }));
  }, [isGlobal, rolesKey]);
}
