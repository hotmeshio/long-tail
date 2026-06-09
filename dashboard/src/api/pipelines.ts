import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTJob, WorkflowExecution } from './types';

interface McpRunFilters {
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
  app_id?: string;
  sort_by?: string;
  order?: string;
}

export function useMcpRuns(filters: McpRunFilters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.sort_by) params.set('sort_by', filters.sort_by);
  if (filters.order) params.set('order', filters.order);
  params.set('app_id', filters.app_id || '');

  return useQuery<{ jobs: LTJob[]; total: number }>({
    queryKey: ['mcpRuns', filters],
    queryFn: () => apiFetch(`/pipelines?${params}`),
  });
}

export function useMcpEntities(appId = '') {
  return useQuery<{ entities: string[] }>({
    queryKey: ['mcpEntities', appId],
    queryFn: () => apiFetch(`/pipelines/entities?app_id=${appId}`),
  });
}

export function useMcpRunExecution(jobId: string, appId = '') {
  return useQuery<WorkflowExecution>({
    queryKey: ['mcpRunExecution', jobId, appId],
    queryFn: () => apiFetch(`/pipelines/${jobId}/execution?app_id=${appId}`),
    enabled: !!jobId,
  });
}

export function useInterruptJob() {
  return useMutation({
    mutationFn: (input: { jobId: string; topic: string; appId: string }) =>
      apiFetch(`/pipelines/${input.jobId}/interrupt`, {
        method: 'POST',
        body: JSON.stringify({ topic: input.topic, app_id: input.appId }),
      }),
  });
}
