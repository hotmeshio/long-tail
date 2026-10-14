import { useAvailableEscalations, useEscalations } from '../api/escalations';
import { useRoleListSchema } from '../api/roles';
import type { LTEscalationRecord } from '../api/types';
import { resolveListRoute, singleRoleOf, type EscalationListParams } from '../lib/escalation-list-url';
import { schemaNeedsEnvelope } from '../lib/schema-needs-envelope';
import { readListSchemaRelations } from '../lib/list-schema';

/** The schema's host-row templates: related sets and row details read their own rows server-side. */
function hostRowTemplates(schema: Record<string, any> | null): Record<string, any> | null {
  if (!schema) return null;
  const { 'x-lt-related': _sets, 'x-lt-row-detail': _detail, ...rest } = schema;
  const columns = Array.isArray(rest['x-lt-columns'])
    ? rest['x-lt-columns'].filter((c: Record<string, unknown>) => !c?.related)
    : rest['x-lt-columns'];
  return { ...rest, 'x-lt-columns': columns };
}

/** The metadata key a facet-table list schema groups its rows by. */
function listGroupKey(schema: Record<string, any> | null): string | undefined {
  try {
    return readListSchemaRelations(schema).groupKey ?? undefined;
  } catch {
    return undefined;
  }
}

export interface EscalationListQueryOptions {
  limit: number;
  offset: number;
  staleTime?: number;
  enabled?: boolean;
}

export interface EscalationListQueryResult {
  escalations: LTEscalationRecord[];
  total: number;
  /** Grouped reads (the schema groups a facet-table): the page's groups. */
  groups: { key: string | null; ids: string[] }[] | null;
  /** The single scoped role's list schema, once it has loaded. */
  listSchema: Record<string, any> | null;
  listSchemaVersion: number | null;
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
  const groupBy = params.view === 'table' || params.view === 'timeline' ? undefined : listGroupKey(listSchema);

  const sharedFilters = {
    role: params.role,
    type: params.type,
    subtype: params.subtype,
    priority: params.priority,
    limit,
    offset,
    // Basic-path fallback only; when orderBy is present (any real sort) the
    // request routes faceted and orderBy drives the ordering instead.
    sort_by: 'created_at',
    order: 'desc' as const,
    search: params.search,
    ...params.facets,
    include: schemaNeedsEnvelope(hostRowTemplates(listSchema)) ? ('envelope' as const) : undefined,
    ...(groupBy ? { groupBy } : {}),
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
    groups: groupBy ? (active.data?.groups ?? null) : null,
    listSchema,
    listSchemaVersion: listSchemaQuery.data?.version ?? null,
    singleRole,
    hasRichView,
    isLoading: active.isLoading,
    isFetching: active.isFetching,
    error: active.error as Error | null,
    refetch: () => { void active.refetch(); },
  };
}
