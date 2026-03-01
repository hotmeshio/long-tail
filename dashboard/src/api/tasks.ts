import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTTaskRecord } from './types';

interface TaskListResponse {
  tasks: LTTaskRecord[];
  total: number;
}

interface TaskFilters {
  status?: string;
  lt_type?: string;
  workflow_type?: string;
  limit?: number;
  offset?: number;
}

export function useTasks(filters: TaskFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.lt_type) params.set('lt_type', filters.lt_type);
  if (filters.workflow_type) params.set('workflow_type', filters.workflow_type);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<TaskListResponse>({
    queryKey: ['tasks', filters],
    queryFn: () => apiFetch(`/tasks?${params}`),
    refetchInterval: 15_000,
  });
}

export function useTask(id: string) {
  return useQuery<LTTaskRecord>({
    queryKey: ['tasks', id],
    queryFn: () => apiFetch(`/tasks/${id}`),
    enabled: !!id,
  });
}

/**
 * Find the task record for a workflow.
 * Tries workflow_id first (leaf workflows), then falls back to
 * parent_workflow_id (orchestrators whose child task carries the envelope).
 */
export function useChildTasks(parentWorkflowId: string) {
  return useQuery<TaskListResponse>({
    queryKey: ['tasks', 'children', parentWorkflowId],
    queryFn: () =>
      apiFetch<TaskListResponse>(
        `/tasks?parent_workflow_id=${encodeURIComponent(parentWorkflowId)}&limit=50`,
      ),
    enabled: !!parentWorkflowId,
  });
}

export function useTaskByWorkflowId(workflowId: string) {
  return useQuery<LTTaskRecord | null>({
    queryKey: ['tasks', 'byWorkflow', workflowId],
    queryFn: async () => {
      // 1. Direct match — leaf workflows have their own task record
      const direct = await apiFetch<TaskListResponse>(
        `/tasks?workflow_id=${encodeURIComponent(workflowId)}&limit=1`,
      );
      if (direct.tasks.length > 0) return direct.tasks[0];

      // 2. Orchestrator fallback — child task has parent_workflow_id = this workflow
      const child = await apiFetch<TaskListResponse>(
        `/tasks?parent_workflow_id=${encodeURIComponent(workflowId)}&limit=1`,
      );
      return child.tasks[0] ?? null;
    },
    enabled: !!workflowId,
  });
}
