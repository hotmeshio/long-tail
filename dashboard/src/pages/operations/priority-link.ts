import type { RoleDetail } from '../../api/roles';

/**
 * Deep link to the available-escalations queue ordered oldest-first by the
 * role's priority age origin: the metadata facet when configured (faceted
 * orderBy, nulls last), else created_at. Mirrors the priority_count SQL so
 * the counted items sit at the top of the list the runner opens.
 */
export function priorityQueueLink(role: Pick<RoleDetail, 'role' | 'priority_facet'>): string {
  const base = `/escalations/available?role=${encodeURIComponent(role.role)}`;
  if (role.priority_facet) {
    const orderBy = JSON.stringify([{ field: `metadata.${role.priority_facet}`, direction: 'asc' }]);
    return `${base}&orderBy=${encodeURIComponent(orderBy)}`;
  }
  return `${base}&sort_by=created_at&order=asc`;
}
