import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LTJob, WorkflowExecution } from './types';

// ── Types ───────────────────────────────────────────────────────────────────

export interface McpQuerySubmitResult {
  workflow_id: string;
  status: string;
  prompt: string;
}

// ── Query keys ──────────────────────────────────────────────────────────────

export const MCP_QUERY_JOBS_KEY = ['mcpQueryJobs'] as const;

// ── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Submit a DIRECT mcpQuery (bypasses router — always dynamic MCP orchestration).
 * Used by the MCP Queries list page where the user explicitly wants a new dynamic seed run.
 */
export function useSubmitMcpQuery() {
  const queryClient = useQueryClient();
  return useMutation<McpQuerySubmitResult, Error, { prompt: string; tags?: string[] }>({
    mutationFn: (params) =>
      apiFetch<McpQuerySubmitResult>('/insight/mcp-query', {
        method: 'POST',
        body: JSON.stringify({ ...params, wait: false, direct: true }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MCP_QUERY_JOBS_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'all' });
    },
  });
}

/**
 * Submit via mcpQueryRouter (checks for deterministic match first).
 * Used by the Verify panel (Panel 6) to test end-to-end routing.
 */
export function useSubmitMcpQueryRouted() {
  const queryClient = useQueryClient();
  return useMutation<McpQuerySubmitResult, Error, { prompt: string; tags?: string[] }>({
    mutationFn: (params) =>
      apiFetch<McpQuerySubmitResult>('/insight/mcp-query', {
        method: 'POST',
        body: JSON.stringify({ ...params, wait: false }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MCP_QUERY_JOBS_KEY, refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['jobs'], refetchType: 'all' });
    },
  });
}

/**
 * List mcpQuery workflow executions (system-level durable workflows).
 * Filters to entity=mcpQuery on the long-tail-system task queue.
 */
export function useMcpQueryJobs(filters: {
  limit?: number;
  offset?: number;
  search?: string;
  status?: string;
  entity?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set('entity', filters.entity || 'mcpQuery,mcpTriage,mcpWorkflowBuilder');
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  params.set('sort_by', 'created_at');
  params.set('order', 'desc');

  return useQuery<{ jobs: LTJob[]; total: number }>({
    queryKey: [...MCP_QUERY_JOBS_KEY, filters],
    queryFn: () => apiFetch(`/workflow-states/jobs?${params}`),
  });
}

/**
 * Get execution timeline for an mcpQuery workflow.
 */
export function useMcpQueryExecution(workflowId: string | undefined) {
  return useQuery<WorkflowExecution>({
    queryKey: ['mcpQueryExecution', workflowId],
    queryFn: () => apiFetch(`/workflow-states/${workflowId}/execution`),
    enabled: !!workflowId,
  });
}

/**
 * Get the result data from a completed mcpQuery workflow.
 */
export function useMcpQueryResult(workflowId: string | undefined) {
  return useQuery<{ workflowId: string; result: { type: string; data: Record<string, unknown> } }>({
    queryKey: ['mcpQueryResult', workflowId],
    queryFn: () => apiFetch(`/workflows/${workflowId}/result`),
    enabled: !!workflowId,
    retry: 2,
  });
}

/**
 * Generate a workflow description and tags from the original prompt + result.
 * Uses an LLM to produce a concise, catalog-style description.
 */
export function useDescribeMcpQuery(params: {
  prompt: string | undefined;
  resultTitle: string | undefined;
  resultSummary: string | undefined;
}) {
  return useQuery<{ tool_name?: string; description: string; tags: string[] }>({
    queryKey: ['mcpQueryDescribe', params.prompt],
    queryFn: () =>
      apiFetch<{ tool_name?: string; description: string; tags: string[] }>('/insight/mcp-query/describe', {
        method: 'POST',
        body: JSON.stringify({
          prompt: params.prompt,
          result_title: params.resultTitle,
          result_summary: params.resultSummary,
        }),
      }),
    enabled: !!params.prompt,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
}

/**
 * Find a YAML workflow compiled from a specific mcpQuery execution.
 */
export function useYamlWorkflowForSource(sourceWorkflowId: string | undefined) {
  return useQuery<{ workflows: Array<{
    id: string; name: string; status: string; graph_topic: string;
    description?: string; tags?: string[]; app_id?: string;
    input_schema?: Record<string, unknown>;
    activity_manifest?: Array<{
      activity_id: string; title: string; type: string;
      tool_source: string; mcp_tool_name?: string;
    }>;
    original_prompt?: string;
  }> }>({
    queryKey: ['yamlWorkflowForSource', sourceWorkflowId],
    queryFn: () => apiFetch(`/yaml-workflows?source_workflow_id=${sourceWorkflowId}&limit=5`),
    enabled: !!sourceWorkflowId,
  });
}
