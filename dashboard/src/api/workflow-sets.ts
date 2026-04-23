import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { WorkflowSetRecord, PlanItem } from './types';

// ── Query keys ──────────────────────────────────────────────────────────────

export const WORKFLOW_SETS_KEY = ['workflowSets'] as const;

// ── Hooks ───────────────────────────────────────────────────────────────────

/** List workflow sets with optional filters. */
export function useWorkflowSets(filters: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
} = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<{ sets: WorkflowSetRecord[]; total: number }>({
    queryKey: [...WORKFLOW_SETS_KEY, filters],
    queryFn: () => apiFetch(`/workflow-sets?${params}`),
  });
}

/** Get a single workflow set by ID. Polls while status is non-terminal. */
export function useWorkflowSet(id: string | undefined) {
  return useQuery<WorkflowSetRecord>({
    queryKey: [...WORKFLOW_SETS_KEY, id],
    queryFn: () => apiFetch(`/workflow-sets/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || status === 'completed' || status === 'failed') return false;
      return 3000;
    },
  });
}

/** Create a new workflow set from a specification. */
export function useCreateWorkflowSet() {
  const queryClient = useQueryClient();
  return useMutation<WorkflowSetRecord & { planner_workflow_id: string }, Error, {
    name: string;
    description?: string;
    specification: string;
  }>({
    mutationFn: (params) =>
      apiFetch('/workflow-sets', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WORKFLOW_SETS_KEY, refetchType: 'all' });
    },
  });
}

/** Update a workflow set's plan (engineer adjustments). */
export function useUpdateWorkflowSetPlan() {
  const queryClient = useQueryClient();
  return useMutation<WorkflowSetRecord, Error, {
    id: string;
    plan: PlanItem[];
    namespaces?: string[];
  }>({
    mutationFn: ({ id, ...body }) =>
      apiFetch(`/workflow-sets/${id}/plan`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WORKFLOW_SETS_KEY, refetchType: 'all' });
    },
  });
}

/** Trigger build phase for a workflow set. */
export function useBuildWorkflowSet() {
  const queryClient = useQueryClient();
  return useMutation<{ status: string; id: string }, Error, string>({
    mutationFn: (id) =>
      apiFetch(`/workflow-sets/${id}/build`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WORKFLOW_SETS_KEY, refetchType: 'all' });
    },
  });
}

/** Deploy all namespaces in a workflow set. */
export function useDeployWorkflowSet() {
  const queryClient = useQueryClient();
  return useMutation<{ status: string; id: string }, Error, string>({
    mutationFn: (id) =>
      apiFetch(`/workflow-sets/${id}/deploy`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WORKFLOW_SETS_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}
