import type { Types } from '@hotmeshio/hotmesh';

import type { LTEscalationRecord, LTEscalationStatus } from '../../types';

import { escalations } from './client';
import { toEscalationRecords } from './map';
import type { EscalationStats } from './types';
import { SORTABLE_COLUMNS } from './types';

type SdkListParams = Types.ListEscalationsParams;
type OrderBy = NonNullable<SdkListParams['orderBy']>;

/**
 * Default sort is priority ASC, created_at ASC. A user-chosen `sort_by` maps to
 * a single column (DESC unless `order='asc'`), matching the legacy behavior.
 */
function buildOrderBy(sortBy?: string, order?: string): OrderBy {
  if (sortBy && SORTABLE_COLUMNS.has(sortBy)) {
    return [{ column: sortBy as OrderBy[number]['column'], direction: order === 'asc' ? 'asc' : 'desc' }];
  }
  return [
    { column: 'priority', direction: 'asc' },
    { column: 'created_at', direction: 'asc' },
  ];
}

export async function getEscalationStats(
  visibleRoles?: string[],
  period?: string,
): Promise<EscalationStats> {
  const client = await escalations();
  return client.stats({
    roles: visibleRoles,
    period: period as '1h' | '24h' | '7d' | '30d' | undefined,
  });
}

export async function listDistinctTypes(): Promise<string[]> {
  const client = await escalations();
  return client.listDistinctTypes();
}

export async function listEscalations(filters: {
  status?: LTEscalationStatus;
  role?: string;
  type?: string;
  subtype?: string;
  assigned_to?: string;
  claimed?: boolean;
  priority?: number;
  limit?: number;
  offset?: number;
  visibleRoles?: string[];
  sort_by?: string;
  order?: string;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const client = await escalations();

  // Shared filter — passed to both list() and count() so totals stay in sync.
  const where: SdkListParams = {
    status: filters.status,
    role: filters.role,
    type: filters.type,
    subtype: filters.subtype,
    priority: filters.priority,
    roles: filters.visibleRoles,
  };
  if (filters.assigned_to) where.assignedTo = filters.assigned_to;
  // Active claim semantics: assigned_to-active and `claimed` both mean "held now".
  if (filters.assigned_to || filters.claimed) where.available = false;

  const [rows, total] = await Promise.all([
    client.list({
      ...where,
      orderBy: buildOrderBy(filters.sort_by, filters.order),
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    }),
    client.count(where),
  ]);

  return { escalations: toEscalationRecords(rows), total };
}

/**
 * List available escalations: pending AND (unassigned OR expired claim).
 */
export async function listAvailableEscalations(filters: {
  role?: string;
  type?: string;
  subtype?: string;
  priority?: number;
  limit?: number;
  offset?: number;
  visibleRoles?: string[];
  sort_by?: string;
  order?: string;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const client = await escalations();

  const where: SdkListParams = {
    status: 'pending',
    available: true,
    role: filters.role,
    type: filters.type,
    subtype: filters.subtype,
    priority: filters.priority,
    roles: filters.visibleRoles,
  };

  const [rows, total] = await Promise.all([
    client.list({
      ...where,
      orderBy: buildOrderBy(filters.sort_by, filters.order),
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    }),
    client.count(where),
  ]);

  return { escalations: toEscalationRecords(rows), total };
}
