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
  priority?: number;
  limit?: number;
  offset?: number;
}

interface EscalationStats {
  pending: number;
  claimed: number;
  created_1h: number;
  created_24h: number;
  resolved_1h: number;
  resolved_24h: number;
  by_role: { role: string; pending: number; claimed: number }[];
}

export function useEscalationStats() {
  return useQuery<EscalationStats>({
    queryKey: ['escalationStats'],
    queryFn: () => apiFetch('/escalations/stats'),
    refetchInterval: 30_000,
  });
}

export function useEscalationTypes() {
  return useQuery<{ types: string[] }>({
    queryKey: ['escalationTypes'],
    queryFn: () => apiFetch('/escalations/types'),
  });
}

export function useEscalations(filters: EscalationFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.role) params.set('role', filters.role);
  if (filters.type) params.set('type', filters.type);
  if (filters.subtype) params.set('subtype', filters.subtype);
  if (filters.assigned_to) params.set('assigned_to', filters.assigned_to);
  if (filters.priority) params.set('priority', String(filters.priority));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<EscalationListResponse>({
    queryKey: ['escalations', filters],
    queryFn: () => apiFetch(`/escalations?${params}`),
    refetchInterval: 10_000,
  });
}

export function useAvailableEscalations(filters: Omit<EscalationFilters, 'status'>) {
  const params = new URLSearchParams();
  if (filters.role) params.set('role', filters.role);
  if (filters.type) params.set('type', filters.type);
  if (filters.subtype) params.set('subtype', filters.subtype);
  if (filters.priority) params.set('priority', String(filters.priority));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<EscalationListResponse>({
    queryKey: ['escalations', 'available', filters],
    queryFn: () => apiFetch(`/escalations/available?${params}`),
    refetchInterval: 10_000,
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
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
      queryClient.invalidateQueries({ queryKey: ['escalations'] });
    },
  });
}
