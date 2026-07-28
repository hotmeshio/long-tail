import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { escalationPattern, escalationPatterns, type EscalationVerb } from '../lib/events/subjects';

/**
 * The escalation subject patterns that can affect the viewing user: one
 * role-scoped pattern per member role. Global viewers (superadmin, admin)
 * span every queue, so they get the family-wide pattern. Pass `verbs` to
 * narrow every pattern to specific lifecycle verbs.
 */
export function useMemberEscalationPatterns(verbs?: EscalationVerb[]): string[] {
  const { user, isSuperAdmin, hasRoleType } = useAuth();
  const isGlobal = isSuperAdmin || hasRoleType('admin');
  const rolesKey = (user?.roles ?? []).map((r) => r.role).sort().join(',');
  const verbsKey = (verbs ?? []).join(',');

  return useMemo(() => {
    const verbList = verbsKey ? (verbsKey.split(',') as EscalationVerb[]) : null;
    if (isGlobal || !rolesKey) {
      return verbList
        ? escalationPatterns({ verbs: verbList })
        : [escalationPattern({})];
    }
    return rolesKey.split(',').flatMap((role) =>
      verbList ? escalationPatterns({ role, verbs: verbList }) : [escalationPattern({ role })],
    );
  }, [isGlobal, rolesKey, verbsKey]);
}
