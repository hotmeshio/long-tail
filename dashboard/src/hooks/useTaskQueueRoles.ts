import { useState, useEffect, useMemo } from 'react';
import { useAuth } from './useAuth';
import { usePersona } from './usePersona';
import { isSystemTierRole, readTaskQueueRoles, TASK_QUEUES_EVENT } from '../lib/task-queues';

/**
 * The roles that surface as Task Queues for the current user.
 *
 * - Operators and engineers get every role they are a member of (a person or a
 *   service account working that lane), minus the capability tiers.
 * - Admins and superadmins get a hand-curated list from localStorage, kept live
 *   via the same-tab custom event and the cross-tab storage event.
 *
 * The list is always sorted and de-duplicated.
 */
export function useTaskQueueRoles(): string[] {
  const { user } = useAuth();
  const { taskQueueSource } = usePersona();

  const membershipRoles = useMemo(() => {
    const names = (user?.roles ?? []).map((r) => r.role).filter((r) => !isSystemTierRole(r));
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [user]);

  const [manualRoles, setManualRoles] = useState<string[]>(readTaskQueueRoles);

  useEffect(() => {
    if (taskQueueSource !== 'manual') return;
    const sync = () => setManualRoles(readTaskQueueRoles());
    sync();
    window.addEventListener(TASK_QUEUES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(TASK_QUEUES_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [taskQueueSource]);

  return taskQueueSource === 'manual' ? manualRoles : membershipRoles;
}
