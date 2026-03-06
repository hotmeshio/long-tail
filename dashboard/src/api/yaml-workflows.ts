import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTYamlWorkflowRecord, LTYamlWorkflowStatus } from './types';

interface YamlWorkflowListResponse {
  workflows: LTYamlWorkflowRecord[];
  total: number;
}

interface YamlWorkflowFilters {
  status?: LTYamlWorkflowStatus;
  limit?: number;
  offset?: number;
}

export function useYamlWorkflows(filters: YamlWorkflowFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<YamlWorkflowListResponse>({
    queryKey: ['yamlWorkflows', filters],
    queryFn: () => apiFetch(`/yaml-workflows?${params}`),
    refetchInterval: 10_000,
  });
}

export function useYamlWorkflow(id: string) {
  return useQuery<LTYamlWorkflowRecord>({
    queryKey: ['yamlWorkflows', id],
    queryFn: () => apiFetch(`/yaml-workflows/${id}`),
    enabled: !!id,
  });
}

export function useCreateYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      workflow_id: string;
      task_queue: string;
      workflow_name: string;
      name: string;
      description?: string;
      app_id?: string;
      subscribes?: string;
    }) =>
      apiFetch<LTYamlWorkflowRecord>('/yaml-workflows', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useDeployYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/deploy`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useActivateYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/activate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useInvokeYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, sync }: { id: string; data: Record<string, unknown>; sync?: boolean }) =>
      apiFetch<{ result?: unknown; job_id?: string }>(`/yaml-workflows/${id}/invoke`, {
        method: 'POST',
        body: JSON.stringify({ data, sync }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useRegenerateYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, task_queue }: { id: string; task_queue?: string }) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ task_queue }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useArchiveYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/archive`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useDeleteYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: boolean }>(`/yaml-workflows/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}
