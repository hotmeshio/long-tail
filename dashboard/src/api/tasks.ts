import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTTaskRecord, LTEscalationRecord } from './types';

interface TaskListResponse {
  tasks: LTTaskRecord[];
  total: number;
}

interface TaskFilters {
  status?: string;
  lt_type?: string;
  workflow_type?: string;
  origin_id?: string;
  limit?: number;
  offset?: number;
}

// ── Process types ─────────────────────────────────────────────────

export interface ProcessSummary {
  origin_id: string;
  task_count: number;
  completed: number;
  escalated: number;
  workflow_types: string[];
  started_at: string;
  last_activity: string;
}

interface ProcessListResponse {
  processes: ProcessSummary[];
  total: number;
}

export interface ProcessDetail {
  origin_id: string;
  tasks: LTTaskRecord[];
  escalations: LTEscalationRecord[];
}

export function useTasks(filters: TaskFilters) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.lt_type) params.set('lt_type', filters.lt_type);
  if (filters.workflow_type) params.set('workflow_type', filters.workflow_type);
  if (filters.origin_id) params.set('origin_id', filters.origin_id);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  return useQuery<TaskListResponse>({
    queryKey: ['tasks', filters],
    queryFn: () => apiFetch(`/tasks?${params}`),
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

// ── Process stats ────────────────────────────────────────────────

export interface ProcessStats {
  total: number;
  active: number;
  completed: number;
  escalated: number;
  by_workflow_type: {
    workflow_type: string;
    total: number;
    active: number;
    completed: number;
    escalated: number;
  }[];
}

export function useProcessStats(period?: string) {
  const params = period ? `?period=${period}` : '';
  return useQuery<ProcessStats>({
    queryKey: ['processStats', period],
    queryFn: () => apiFetch(`/tasks/processes/stats${params}`),
  });
}

// ── Process hooks ─────────────────────────────────────────────────

export function useProcesses(filters?: {
  limit?: number;
  offset?: number;
  workflow_type?: string;
  status?: string;
  search?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.limit) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters?.workflow_type) params.set('workflow_type', filters.workflow_type);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.search) params.set('search', filters.search);

  return useQuery<ProcessListResponse>({
    queryKey: ['processes', filters],
    queryFn: () => apiFetch(`/tasks/processes?${params}`),
  });
}

export function useProcessDetail(originId: string) {
  return useQuery<ProcessDetail>({
    queryKey: ['processes', originId],
    queryFn: () => apiFetch(`/tasks/processes/${encodeURIComponent(originId)}`),
    enabled: !!originId,
  });
}
