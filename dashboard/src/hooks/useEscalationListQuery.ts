import { useAvailableEscalations, useEscalations } from '../api/escalations';
import { useRoleListSchema } from '../api/roles';
import type { LTEscalationRecord } from '../api/types';
import { resolveListRoute, singleRoleOf, type EscalationListParams } from '../lib/escalation-list-url';
import { schemaNeedsEnvelope } from '../lib/schema-needs-envelope';

export interface EscalationListQueryOptions {
  limit: number;
  offset: number;
  staleTime?: number;
  enabled?: boolean;
}

export interface EscalationListQueryResult {
  escalations: LTEscalationRecord[];
  total: number;
  /** The single scoped role's list schema, once it has loaded. */
  listSchema: Record<string, any> | null;
  singleRole: string | null;
  /** The role owns a non-table list schema, so the rich presentation is available. */
  hasRichView: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * The escalations list query for one set of list params: the page's address
 * bar or a saved URL. The single-role list schema resolves first, since it
 * decides whether the rows need the envelope and payload columns; the rows
 * then come from the available pool or the plain list as the status routes.
 */
export function useEscalationListQuery(
  params: EscalationListParams,
  { limit, offset, staleTime, enabled = true }: EscalationListQueryOptions,
): EscalationListQueryResult {
  const { available, claimed, apiStatus } = resolveListRoute(params.statusFilter);
  const singleRole = singleRoleOf(params);
  const listSchemaQuery = useRoleListSchema(singleRole ?? '', undefined, enabled && !!singleRole);
  const listSchema = (listSchemaQuery.data?.list_schema ?? null) as Record<string, any> | null;
  const schemaSettled = !singleRole || listSchemaQuery.isFetched;

  const sharedFilters = {
    role: params.role,
    type: params.type,
    priority: params.priority,
    limit,
    offset,
    // Basic-path fallback only; when orderBy is present (any real sort) the
    // request routes faceted and orderBy drives the ordering instead.
    sort_by: 'created_at',
    order: 'desc' as const,
    search: params.search,
    ...params.facets,
    include: schemaNeedsEnvelope(listSchema) ? ('envelope' as const) : undefined,
    ...(staleTime !== undefined ? { staleTime } : {}),
  };

  const availableQuery = useAvailableEscalations({
    ...sharedFilters,
    enabled: enabled && available && schemaSettled,
  });
  const escalationsQuery = useEscalations({
    status: apiStatus,
    claimed: claimed || undefined,
    ...sharedFilters,
    enabled: enabled && !available && schemaSettled,
  });
  const active = available ? availableQuery : escalationsQuery;

  const hasRichView = !!singleRole && !!listSchema
    && !!listSchema['x-lt-layout'] && listSchema['x-lt-layout'] !== 'table';

  return {
    escalations: active.data?.escalations ?? [],
    total: active.data?.total ?? 0,
    listSchema,
    singleRole,
    hasRichView,
    isLoading: active.isLoading,
    isFetching: active.isFetching,
    error: active.error as Error | null,
    refetch: () => { void active.refetch(); },
  };
}
