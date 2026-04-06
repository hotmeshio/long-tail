import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { ActiveWorker, CronScheduleEntry, DiscoveredWorkflow, LTJob, LTWorkflowConfig, WorkflowExecution } from './types';

export function useActiveWorkers() {
  return useQuery<ActiveWorker[]>({
    queryKey: ['activeWorkers'],
    queryFn: async () => {
      const res = await apiFetch<{ workers: ActiveWorker[] }>('/workflows/workers');
      return res.workers;
    },
  });
}

export function useDiscoveredWorkflows() {
  return useQuery<DiscoveredWorkflow[]>({
    queryKey: ['discoveredWorkflows'],
    queryFn: async () => {
      const res = await apiFetch<{ workflows: DiscoveredWorkflow[] }>('/workflows/discovered');
      return res.workflows;
    },
  });
}

export function useWorkflowConfigs() {
  return useQuery<LTWorkflowConfig[]>({
    queryKey: ['workflowConfigs'],
    queryFn: async () => {
      const res = await apiFetch<{ workflows: LTWorkflowConfig[] }>('/workflows/config');
      return res.workflows;
    },
  });
}

export function useCronStatus() {
  return useQuery<CronScheduleEntry[]>({
    queryKey: ['cronStatus'],
    queryFn: async () => {
      const res = await apiFetch<{ schedules: CronScheduleEntry[] }>('/workflows/cron/status');
      return res.schedules;
    },
  });
}

export function useWorkflowExecution(workflowId: string) {
  return useQuery<WorkflowExecution>({
    queryKey: ['workflowExecution', workflowId],
    queryFn: () =>
      apiFetch(`/workflow-states/${workflowId}/execution`),
    enabled: !!workflowId,
  });
}

export function useWorkflowState(workflowId: string) {
  return useQuery<{ workflow_id: string; state: Record<string, unknown> }>({
    queryKey: ['workflowState', workflowId],
    queryFn: () => apiFetch(`/workflow-states/${workflowId}/state`),
    enabled: !!workflowId,
  });
}

export function useJobs(filters: {
  limit?: number;
  offset?: number;
  entity?: string;
  search?: string;
  status?: string;
  sort_by?: string;
  order?: string;
  registered?: string;
}) {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.entity) params.set('entity', filters.entity);
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.sort_by) params.set('sort_by', filters.sort_by);
  if (filters.order) params.set('order', filters.order);
  if (filters.registered) params.set('registered', filters.registered);

  return useQuery<{ jobs: LTJob[]; total: number }>({
    queryKey: ['jobs', filters],
    queryFn: () => apiFetch(`/workflow-states/jobs?${params}`),
  });
}

export function useTerminateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) =>
      apiFetch(`/workflows/${workflowId}/terminate`, { method: 'POST' }),
    onSuccess: (_data, workflowId) => {
      queryClient.invalidateQueries({ queryKey: ['workflowExecution', workflowId], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'all' });
    },
  });
}

export function useUpsertWorkflowConfig() {
  const queryClient = useQueryClient();
  return useMutation<
    LTWorkflowConfig,
    Error,
    {
      workflow_type: string;
      description?: string | null;

      invocable?: boolean;
      task_queue?: string | null;
      default_role?: string;
      roles?: string[];
      invocation_roles?: string[];
      consumes?: string[];
      envelope_schema?: Record<string, unknown> | null;
      resolver_schema?: Record<string, unknown> | null;
      cron_schedule?: string | null;
      execute_as?: string | null;
    }
  >({
    mutationFn: ({ workflow_type, ...body }) =>
      apiFetch(`/workflows/${encodeURIComponent(workflow_type)}/config`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowConfigs'], refetchType: 'all' });
    },
  });
}

export function useDeleteWorkflowConfig() {
  const queryClient = useQueryClient();
  return useMutation<{ deleted: boolean; workflow_type: string }, Error, string>({
    mutationFn: (workflowType) =>
      apiFetch(`/workflows/${encodeURIComponent(workflowType)}/config`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowConfigs'], refetchType: 'all' });
    },
  });
}

export function useSetCronSchedule() {
  const queryClient = useQueryClient();
  return useMutation<
    LTWorkflowConfig,
    Error,
    { config: LTWorkflowConfig; cron_schedule: string | null; envelope_schema?: Record<string, unknown> | null }
  >({
    mutationFn: ({ config, cron_schedule, envelope_schema }) =>
      apiFetch(`/workflows/${encodeURIComponent(config.workflow_type)}/config`, {
        method: 'PUT',
        body: JSON.stringify({
          ...config,
          cron_schedule,
          ...(envelope_schema !== undefined ? { envelope_schema } : {}),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflowConfigs'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['cronStatus'], refetchType: 'all' });
    },
  });
}

export function useInvokeWorkflow() {
  const queryClient = useQueryClient();
  return useMutation<
    { workflowId: string; message: string },
    Error,
    { workflowType: string; data: Record<string, unknown>; metadata?: Record<string, unknown>; execute_as?: string }
  >({
    mutationFn: ({ workflowType, data, metadata, execute_as }) =>
      apiFetch(`/workflows/${workflowType}/invoke`, {
        method: 'POST',
        body: JSON.stringify({ data, metadata, ...(execute_as ? { execute_as } : {}) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'all' });
    },
  });
}
