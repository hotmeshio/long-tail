import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTJob, WorkflowExecution } from './types';

interface McpRunFilters {
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
  app_id?: string;
}

export function useMcpRuns(filters: McpRunFilters = {}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  params.set('app_id', filters.app_id || 'longtail');

  return useQuery<{ jobs: LTJob[]; total: number }>({
    queryKey: ['mcpRuns', filters],
    queryFn: () => apiFetch(`/mcp-runs?${params}`),
    refetchInterval: 10_000,
  });
}

export function useMcpRunExecution(jobId: string, appId = 'longtail') {
  return useQuery<WorkflowExecution>({
    queryKey: ['mcpRunExecution', jobId, appId],
    queryFn: () => apiFetch(`/mcp-runs/${jobId}/execution?app_id=${appId}`),
    enabled: !!jobId,
  });
}
