import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTJob } from './types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface BuildWorkflowResult {
  workflow_id: string;
  status: string;
  prompt: string;
}

export interface WorkflowBuilderOutput {
  name: string;
  description: string;
  yaml: string;
  input_schema: Record<string, unknown>;
  activity_manifest: Array<Record<string, unknown>>;
  tags: string[];
  sample_inputs: Record<string, unknown>;
  build_attempts: number;
}

// ── Query keys ──────────────────────────────────────────────────────────────

export const BUILDER_JOBS_KEY = ['builderJobs'] as const;

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Submit a new workflow builder request (or answer clarification questions). */
export function useSubmitBuildWorkflow() {
  const queryClient = useQueryClient();
  return useMutation<BuildWorkflowResult, Error, {
    prompt: string;
    tags?: string[];
    answers?: string;
    prior_questions?: string[];
  }>({
    mutationFn: (params) =>
      apiFetch<BuildWorkflowResult>('/insight/build-workflow', {
        method: 'POST',
        body: JSON.stringify({ ...params, wait: false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BUILDER_JOBS_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'all' });
    },
  });
}

/** Submit a refinement request with prior YAML and feedback. */
export function useRefineBuildWorkflow() {
  const queryClient = useQueryClient();
  return useMutation<BuildWorkflowResult, Error, {
    prompt: string;
    prior_yaml: string;
    feedback: string;
    tags?: string[];
  }>({
    mutationFn: (params) =>
      apiFetch<BuildWorkflowResult>('/insight/build-workflow/refine', {
        method: 'POST',
        body: JSON.stringify({ ...params, wait: false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BUILDER_JOBS_KEY, refetchType: 'all' });
    },
  });
}

/** List workflow builder executions. */
export function useBuilderJobs(filters: {
  limit?: number;
  offset?: number;
  search?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set('entity', 'mcpWorkflowBuilder');
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.search) params.set('search', filters.search);
  params.set('sort_by', 'created_at');
  params.set('order', 'desc');

  return useQuery<{ jobs: LTJob[]; total: number }>({
    queryKey: [...BUILDER_JOBS_KEY, filters],
    queryFn: () => apiFetch(`/workflow-states/jobs?${params}`),
  });
}

/** Create a YAML workflow directly from builder output (no compilation). */
export function useCreateDirectYamlWorkflow() {
  const queryClient = useQueryClient();
  return useMutation<any, Error, {
    name: string;
    description?: string;
    yaml_content: string;
    input_schema?: Record<string, unknown>;
    activity_manifest?: Array<Record<string, unknown>>;
    tags?: string[];
    app_id?: string;
  }>({
    mutationFn: (params) =>
      apiFetch('/yaml-workflows/direct', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['yamlWorkflows'], refetchType: 'all' });
    },
  });
}

/** Get the result from a completed builder workflow. */
export function useBuilderResult(workflowId: string | undefined) {
  return useQuery<{ workflowId: string; result: { type: string; data: WorkflowBuilderOutput } }>({
    queryKey: ['builderResult', workflowId],
    queryFn: () => apiFetch(`/workflows/${workflowId}/result`),
    enabled: !!workflowId,
  });
}
