import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTYamlWorkflowRecord, LTYamlWorkflowStatus, LTYamlWorkflowVersion } from './types';

interface YamlWorkflowListResponse {
  workflows: LTYamlWorkflowRecord[];
  total: number;
}

interface YamlWorkflowFilters {
  status?: LTYamlWorkflowStatus;
  graph_topic?: string;
  app_id?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useYamlWorkflows(filters: YamlWorkflowFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.graph_topic) params.set('graph_topic', filters.graph_topic);
  if (filters.app_id) params.set('app_id', filters.app_id);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<YamlWorkflowListResponse>({
    queryKey: ['yamlWorkflows', filters],
    queryFn: () => apiFetch(`/yaml-workflows?${params}`),
  });
}

export function useYamlWorkflowAppIds() {
  return useQuery<{ app_ids: string[] }>({
    queryKey: ['yamlWorkflowAppIds'],
    queryFn: () => apiFetch('/yaml-workflows/app-ids'),
  });
}

export function useYamlWorkflowByTopic(graphTopic: string | undefined, appId?: string) {
  return useQuery<YamlWorkflowListResponse>({
    queryKey: ['yamlWorkflows', 'byTopic', graphTopic, appId],
    queryFn: () => {
      const params = new URLSearchParams({ graph_topic: graphTopic!, limit: '1' });
      if (appId) params.set('app_id', appId);
      return apiFetch(`/yaml-workflows?${params}`);
    },
    enabled: !!graphTopic,
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
      tags?: string[];
      compilation_feedback?: string;
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
    mutationFn: ({ id, data, sync, execute_as }: { id: string; data: Record<string, unknown>; sync?: boolean; execute_as?: string }) =>
      apiFetch<{ result?: unknown; job_id?: string }>(`/yaml-workflows/${id}/invoke`, {
        method: 'POST',
        body: JSON.stringify({ data, sync, ...(execute_as ? { execute_as } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useRegenerateYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, task_queue, compilation_feedback }: { id: string; task_queue?: string; compilation_feedback?: string }) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ task_queue, compilation_feedback }),
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

export function useUpdateYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string; yaml_content?: string; name?: string; description?: string; input_schema?: Record<string, unknown>; output_schema?: Record<string, unknown>; tags?: string[] }) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
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

// ── Cron scheduling ─────────────────────────────────────────────

export function useSetYamlCron() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cron_schedule, cron_envelope, execute_as }: {
      id: string;
      cron_schedule: string;
      cron_envelope?: Record<string, unknown> | null;
      execute_as?: string | null;
    }) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/cron`, {
        method: 'PUT',
        body: JSON.stringify({ cron_schedule, cron_envelope, execute_as }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

export function useClearYamlCron() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<LTYamlWorkflowRecord>(`/yaml-workflows/${id}/cron`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

// ── Version history ─────────────────────────────────────────────

export function useYamlWorkflowVersions(id: string) {
  return useQuery<{ versions: LTYamlWorkflowVersion[]; total: number }>({
    queryKey: ['yamlWorkflows', id, 'versions'],
    queryFn: () => apiFetch(`/yaml-workflows/${id}/versions`),
    enabled: !!id,
  });
}

export function useYamlWorkflowVersion(id: string, version: number | null) {
  return useQuery<LTYamlWorkflowVersion>({
    queryKey: ['yamlWorkflows', id, 'versions', version],
    queryFn: () => apiFetch(`/yaml-workflows/${id}/versions/${version}`),
    enabled: !!id && version !== null,
  });
}
