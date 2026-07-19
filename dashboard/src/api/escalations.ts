import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTEscalationRecord } from './types';

interface EscalationListResponse {
  escalations: LTEscalationRecord[];
  total: number;
}

export interface FacetRange { facet: string; op: '<' | '<=' | '>' | '>=' | '='; value: number }
export interface FacetOrder { field: string; direction?: 'asc' | 'desc'; numeric?: boolean }

/** The faceted-query elements shared by the list/available hooks. */
export interface FacetFilters {
  roles?: string[];
  facets?: Record<string, unknown>;
  block?: Record<string, unknown>[];
  range?: FacetRange[];
  exists?: string[];
  available?: boolean;
  /** Only rows past their role's priority threshold — the Pace Board pill's
   *  exact predicate, so a jeopardy list's total equals the pill's count. */
  jeopardy?: boolean;
  orderBy?: FacetOrder[];
}

interface EscalationFilters extends FacetFilters {
  status?: string;
  role?: string;
  type?: string;
  subtype?: string;
  assigned_to?: string;
  claimed?: boolean;
  priority?: number;
  limit?: number;
  offset?: number;
  sort_by?: string;
  order?: string;
  search?: string;
  enabled?: boolean;
  staleTime?: number;
}

/** JSON-encode the faceted-query elements onto the URL (the route JSON-parses them). */
function appendFacetParams(params: URLSearchParams, f: FacetFilters): void {
  if (f.facets && Object.keys(f.facets).length) params.set('facets', JSON.stringify(f.facets));
  if (f.block?.length) params.set('block', JSON.stringify(f.block));
  if (f.range?.length) params.set('range', JSON.stringify(f.range));
  if (f.exists?.length) params.set('exists', JSON.stringify(f.exists));
  if (f.roles?.length) params.set('roles', JSON.stringify(f.roles));
  if (f.orderBy?.length) params.set('orderBy', JSON.stringify(f.orderBy));
  if (f.available !== undefined) params.set('available', String(f.available));
  if (f.jeopardy === true) params.set('jeopardy', '1');
}

export interface EscalationStats {
  pending: number;
  claimed: number;
  created: number;
  resolved: number;
  by_role: { role: string; pending: number; claimed: number }[];
  by_type: { type: string; pending: number; claimed: number; resolved: number }[];
}

export interface StationMetricPeriod {
  p99: number | null;
  p50: number | null;
  avg: number | null;
  max: number | null;
}

export interface StationMetric {
  role: string;
  pending: number;
  claimed: number;
  resolved: number;
  /**
   * Pending, unclaimed items past the role's threshold — the Pace Board
   * rebalance signal. Age is measured from the role's priority_facet metadata
   * timestamp (created_at when unset) against priority_threshold_minutes
   * (sla_minutes when unset).
   */
  priority_count: number;
  throughput_pct: number | null;
  wait: StationMetricPeriod;
  work: StationMetricPeriod;
}

export function useStationMetrics(period?: string, opts?: { enabled?: boolean }) {
  const p = period ?? '24h';
  return useQuery<{ stations: StationMetric[] }>({
    queryKey: ['stationMetrics', p],
    queryFn: () => apiFetch(`/escalations/station-metrics?period=${p}`),
    staleTime: 5_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useEscalationStats(period?: string) {
  const params = period ? `?period=${period}` : '';
  return useQuery<EscalationStats>({
    queryKey: ['escalationStats', period],
    queryFn: () => apiFetch(`/escalations/stats${params}`),
  });
}

export function useEscalationTypes() {
  return useQuery<{ types: string[] }>({
    queryKey: ['escalationTypes'],
    queryFn: () => apiFetch('/escalations/types'),
  });
}

/** Distinct top-level metadata facet keys the caller may query (role-scoped). */
export function useFacetKeys(enabled = true) {
  return useQuery<{ keys: string[] }>({
    queryKey: ['escalationFacetKeys'],
    queryFn: () => apiFetch('/escalations/facet-keys'),
    enabled,
    staleTime: 60_000,
  });
}

export function useEscalations(filters: EscalationFilters) {
  const { enabled = true, staleTime, ...rest } = filters;
  const params = new URLSearchParams();
  if (rest.status) params.set('status', rest.status);
  if (rest.role) params.set('role', rest.role);
  if (rest.type) params.set('type', rest.type);
  if (rest.subtype) params.set('subtype', rest.subtype);
  if (rest.assigned_to) params.set('assigned_to', rest.assigned_to);
  if (rest.claimed) params.set('claimed', 'true');
  if (rest.priority) params.set('priority', String(rest.priority));
  if (rest.limit) params.set('limit', String(rest.limit));
  if (rest.offset !== undefined) params.set('offset', String(rest.offset));
  if (rest.sort_by) params.set('sort_by', rest.sort_by);
  if (rest.order) params.set('order', rest.order);
  if (rest.search) params.set('search', rest.search);
  appendFacetParams(params, rest);

  return useQuery<EscalationListResponse>({
    queryKey: ['escalations', rest],
    queryFn: () => apiFetch(`/escalations?${params}`),
    enabled,
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}

export function useAvailableEscalations(filters: Omit<EscalationFilters, 'status'>) {
  const { enabled = true, staleTime, ...rest } = filters;
  const params = new URLSearchParams();
  if (rest.role) params.set('role', rest.role);
  if (rest.type) params.set('type', rest.type);
  if (rest.subtype) params.set('subtype', rest.subtype);
  if (rest.priority) params.set('priority', String(rest.priority));
  if (rest.limit) params.set('limit', String(rest.limit));
  if (rest.offset !== undefined) params.set('offset', String(rest.offset));
  if (rest.sort_by) params.set('sort_by', rest.sort_by);
  if (rest.order) params.set('order', rest.order);
  if (rest.search) params.set('search', rest.search);
  appendFacetParams(params, rest);

  return useQuery<EscalationListResponse>({
    queryKey: ['escalations', 'available', rest],
    queryFn: () => apiFetch(`/escalations/available?${params}`),
    enabled,
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}

export function useEscalationsByWorkflowId(workflowId: string | undefined) {
  return useQuery<{ escalations: LTEscalationRecord[] }>({
    queryKey: ['escalations', 'by-workflow', workflowId],
    queryFn: () => apiFetch(`/escalations/by-workflow/${workflowId}`),
    enabled: !!workflowId,
  });
}

export function useEscalation(id: string) {
  return useQuery<LTEscalationRecord>({
    queryKey: ['escalations', id],
    queryFn: () => apiFetch(`/escalations/${id}`),
    enabled: !!id,
  });
}

export function useClaimEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, durationMinutes }: { id: string; durationMinutes: number }) =>
      apiFetch(`/escalations/${id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ durationMinutes }),
      }),
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
    },
  });
}

export function useReleaseEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/escalations/${id}/release`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
    },
  });
}

export function useResolveEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      resolverPayload,
    }: {
      id: string;
      resolverPayload: Record<string, unknown>;
    }) =>
      apiFetch(`/escalations/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolverPayload }),
      }),
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
      queryClient.resetQueries({ queryKey: ['tasks'] });
      queryClient.resetQueries({ queryKey: ['jobs'] });
    },
  });
}

export function useEscalateToRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetRole }: { id: string; targetRole: string }) =>
      apiFetch(`/escalations/${id}/escalate`, {
        method: 'PATCH',
        body: JSON.stringify({ targetRole }),
      }),
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
    },
  });
}

export function useSetEscalationPriority() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, priority }: { ids: string[]; priority: 1 | 2 | 3 | 4 }) =>
      apiFetch<{ updated: number }>('/escalations/priority', {
        method: 'PATCH',
        body: JSON.stringify({ ids, priority }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalations'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['escalationStats'], refetchType: 'all' });
    },
  });
}

export function useBulkClaimEscalations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, durationMinutes }: { ids: string[]; durationMinutes: number }) =>
      apiFetch<{ claimed: number; skipped: number }>('/escalations/bulk-claim', {
        method: 'POST',
        body: JSON.stringify({ ids, durationMinutes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalations'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['escalationStats'], refetchType: 'all' });
    },
  });
}

export function useBulkAssignEscalations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ids,
      targetUserId,
      durationMinutes,
    }: {
      ids: string[];
      targetUserId: string;
      durationMinutes: number;
    }) =>
      apiFetch<{ assigned: number; skipped: number }>('/escalations/bulk-assign', {
        method: 'POST',
        body: JSON.stringify({ ids, targetUserId, durationMinutes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalations'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['escalationStats'], refetchType: 'all' });
    },
  });
}

export function useBulkEscalateToRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, targetRole }: { ids: string[]; targetRole: string }) =>
      apiFetch<{ updated: number }>('/escalations/bulk-escalate', {
        method: 'PATCH',
        body: JSON.stringify({ ids, targetRole }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalations'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['escalationStats'], refetchType: 'all' });
    },
  });
}

export function useBulkTriageEscalations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, hint }: { ids: string[]; hint?: string }) =>
      apiFetch<{ triaged: number; workflows: string[] }>('/escalations/bulk-triage', {
        method: 'POST',
        body: JSON.stringify({ ids, ...(hint ? { hint } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalations'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['escalationStats'], refetchType: 'all' });
    },
  });
}

export function useCancelEscalation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ cancelled: boolean; escalationId: string }>(`/escalations/${id}/cancel`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.resetQueries({ queryKey: ['escalations'] });
      queryClient.resetQueries({ queryKey: ['escalationStats'] });
    },
  });
}

export function useBulkCancelEscalations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ids }: { ids: string[] }) =>
      apiFetch<{ cancelled: number; skipped: number }>('/escalations/bulk-cancel', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['escalations'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['escalationStats'], refetchType: 'all' });
    },
  });
}
