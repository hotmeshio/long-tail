import { useMemo } from 'react';
import { Database } from 'lucide-react';
import { SidebarNav, type NavItem } from './SidebarNav';
import { useTaskQueueRoles } from '../../hooks/useTaskQueueRoles';
import { useRoleDetails } from '../../api/roles';

/**
 * The Task Queues section — one solid-icon link per lane the user works.
 * Operators and engineers see every role they belong to; admins and superadmins
 * see the roles they hand-picked from the role page. The section hides entirely
 * when there are no queues, so it never shows an empty heading.
 */
export function TaskQueuesSidebar() {
  const roles = useTaskQueueRoles();
  const { data } = useRoleDetails({ enabled: roles.length > 0 });

  const titleByRole = useMemo(
    () => new Map((data?.roles ?? []).map((r) => [r.role, r.title])),
    [data],
  );

  const entries: NavItem[] = useMemo(
    () =>
      roles.map((role) => ({
        to: `/escalations/available?role=${encodeURIComponent(role)}`,
        label: titleByRole.get(role) || role,
        icon: Database,
        solid: true,
        // Rotate the cylinder onto its side so it reads as a queue, not a DB.
        iconClassName: 'rotate-90',
      })),
    [roles, titleByRole],
  );

  if (entries.length === 0) return null;

  return <SidebarNav heading="Task Queues" entries={entries} />;
}
