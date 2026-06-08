import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTEscalationRecord } from './types';

interface EscalationListResponse {
  escalations: LTEscalationRecord[];
  total: number;
}

interface EscalationFilters {
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
  enabled?: boolean;
  staleTime?: number;
}

export interface EscalationStats {
  pending: number;
  claimed: number;
  created: number;
  resolved: number;
  by_role: { role: string; pending: number; claimed: number }[];
  by_type: { type: string; pending: number; claimed: number; resolved: number }[];
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
