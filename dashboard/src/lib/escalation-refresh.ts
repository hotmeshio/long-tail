import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { NatsLTEvent } from './nats/types';
import { sanitizeSubjectToken } from './events/subjects';
import type { RefreshTier } from './realtime-refresh';

/**
 * Routes one escalation event to the cached escalation queries it can
 * affect. A query is skipped only when the event provably cannot change its
 * answer; anything uncertain refreshes. Each query refreshes on the tier its
 * shape implies, so a count and a list never share a lane.
 */

const ESCALATION_TYPE_PREFIX = 'system.escalation.';
const ID_SEGMENT = /^[0-9a-f][0-9a-f-]{7,}$/i;

export interface EscalationChange {
  id: string | null;
  verb: string | null;
  /** Queues the change touches: the row's role and both ends of a move. */
  roles: string[];
  assignedTo: string | null;
  reassignedFrom: string | null;
  workflowId: string | null;
  /** The row's metadata facets, present only for viewers who receive them. */
  facets: Record<string, unknown> | null;
}

export interface AffectedQuery {
  tier: RefreshTier;
  queryKey: QueryKey;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function typeTokens(type: string): { role: string | null; id: string | null; verb: string | null } {
  if (!type.startsWith(ESCALATION_TYPE_PREFIX)) return { role: null, id: null, verb: null };
  const [role, id, verb] = type.slice(ESCALATION_TYPE_PREFIX.length).split('.');
  return { role: role ?? null, id: id ?? null, verb: verb ?? null };
}

/** What an escalation event says about the row that moved. */
export function escalationChangeOf(event: NatsLTEvent): EscalationChange {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const tokens = typeTokens(event.type);
  const roles = [
    text((event as { role?: unknown }).role) ?? text(data.role) ?? tokens.role,
    text(data.from_role),
    text(data.to_role),
  ].filter((role): role is string => role !== null);
  const metadata = data.metadata;
  return {
    id: event.escalationId ?? text(data.id) ?? tokens.id,
    verb: tokens.verb,
    roles,
    assignedTo: text(data.assigned_to),
    reassignedFrom: text(data.reassigned_from),
    workflowId: text(event.workflowId) ?? text(data.workflow_id),
    facets: metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : null,
  };
}

function rolesExclude(filterRoles: string[], change: EscalationChange): boolean {
  if (change.roles.length === 0) return false;
  const wanted = new Set(filterRoles.map(sanitizeSubjectToken));
  return !change.roles.some((role) => wanted.has(sanitizeSubjectToken(role)));
}

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

function facetsExclude(filter: Record<string, unknown>, facets: Record<string, unknown>): boolean {
  return Object.entries(filter).some(([key, wanted]) => {
    const actual = facets[key];
    return isScalar(wanted) && isScalar(actual) && String(wanted) !== String(actual);
  });
}

function rowsOf(data: unknown): Array<{ id?: string }> {
  const rows = (data as { escalations?: unknown } | undefined)?.escalations;
  return Array.isArray(rows) ? (rows as Array<{ id?: string }>) : [];
}

function listFilters(key: QueryKey): Record<string, unknown> | null {
  const filters = key[0] === 'escalations' && key[1] === 'available' ? key[2] : key[1];
  return filters && typeof filters === 'object' ? (filters as Record<string, unknown>) : null;
}

function listIsAffected(key: QueryKey, data: unknown, change: EscalationChange): boolean {
  if (change.id && rowsOf(data).some((row) => row.id === change.id)) return true;
  const filters = listFilters(key) ?? {};
  const role = text(filters.role);
  const roles = Array.isArray(filters.roles) ? (filters.roles as string[]) : [];
  const scope = role ? [role, ...roles] : roles;
  if (scope.length > 0 && rolesExclude(scope, change)) return false;

  const assignee = text(filters.assigned_to);
  if (assignee && change.verb !== 'released' && change.assignedTo !== null
    && change.assignedTo !== assignee && change.reassignedFrom !== assignee) {
    return false;
  }

  const facetFilter = filters.facets;
  if (facetFilter && typeof facetFilter === 'object' && change.facets && change.verb !== 'updated'
    && facetsExclude(facetFilter as Record<string, unknown>, change.facets)) {
    return false;
  }
  return true;
}

function listTier(key: QueryKey): RefreshTier {
  const limit = listFilters(key)?.limit;
  return typeof limit === 'number' && limit <= 1 ? 'SUMMARY' : 'LIST';
}

function classify(
  key: QueryKey,
  data: unknown,
  change: EscalationChange,
): RefreshTier | null {
  const segment = key[1];
  if (segment === 'by-workflow') {
    return key[2] === change.workflowId ? 'DETAIL' : null;
  }
  if (segment === 'related' || segment === 'related-rows') {
    const role = text(key[2]);
    return role === null || change.roles.length === 0
      || change.roles.some((r) => sanitizeSubjectToken(r) === sanitizeSubjectToken(role))
      ? 'LIST'
      : null;
  }
  if (segment === 'available' || (segment && typeof segment === 'object') || segment === undefined) {
    return listIsAffected(key, data, change) ? listTier(key) : null;
  }
  if (typeof segment === 'string' && ID_SEGMENT.test(segment)) {
    return segment === change.id ? 'DETAIL' : null;
  }
  return 'LIST';
}

/** The cached escalation queries a change may affect, each with the tier it refreshes on. */
export function affectedEscalationQueries(qc: QueryClient, change: EscalationChange): AffectedQuery[] {
  const affected: AffectedQuery[] = [];
  for (const query of qc.getQueryCache().findAll({ queryKey: ['escalations'] })) {
    const tier = classify(query.queryKey, query.state.data, change);
    if (tier) affected.push({ tier, queryKey: query.queryKey });
  }
  return affected;
}
