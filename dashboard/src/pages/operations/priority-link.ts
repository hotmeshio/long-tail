import type { RoleDetail } from '../../api/roles';

/**
 * The jeopardy deep link — the plant manager's "focus on exactly these n items".
 * One builder for every jeopardy pill (Pace Board chart, Home mini board, the
 * operator's Task Queue cards), producing a URL that reproduces the pill's set
 * precisely:
 *
 * - `jeopardy=1` — the server-side threshold predicate (the SAME expression
 *   that produced the pill's count), so the list total equals the pill.
 * - `orderBy` on the role's age origin, ascending — oldest first. The metadata
 *   facet when configured, else created_at; the sort control labels the field.
 * - `view=table` — a discrete, countable list, never the timeline.
 */
export function jeopardyQueueLink(role: Pick<RoleDetail, 'role' | 'priority_facet'>): string {
  const field = role.priority_facet ? `metadata.${role.priority_facet}` : 'created_at';
  const orderBy = JSON.stringify([{ field, direction: 'asc' }]);
  return `/escalations/available?role=${encodeURIComponent(role.role)}&jeopardy=1&view=table&orderBy=${encodeURIComponent(orderBy)}`;
}
