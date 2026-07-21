import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { isSystemTierRole } from '../lib/task-queues';

/**
 * The roles that surface as task queues for the current user: every role they
 * are a member of (a person or service account working that lane), minus the
 * capability tiers. Sorted and de-duplicated. Any further queue views a user
 * wants come from personal pins.
 */
export function useTaskQueueRoles(): string[] {
  const { user } = useAuth();

  return useMemo(() => {
    const names = (user?.roles ?? []).map((r) => r.role).filter((r) => !isSystemTierRole(r));
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [user]);
}
