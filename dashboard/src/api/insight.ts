import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type QueryMode = 'ask' | 'do';

export interface InsightResult {
  title: string;
  summary: string;
  sections: { heading: string; content: string }[];
  metrics: { label: string; value: string }[];
  tool_calls_made: number;
  query: string;
  workflow_id: string;
  duration_ms: number;
}

export interface McpQueryResult {
  title: string;
  summary: string;
  result: any;
  tool_calls_made: number;
  prompt: string;
  workflow_id: string;
  duration_ms: number;
}

const INSIGHT_KEY = ['insight'] as const;
const MCP_QUERY_KEY = ['mcp-query'] as const;

/**
 * Query-based insight hook (Ask mode). Read-only analytics.
 */
export function useInsightQuery(question: string | null) {
  return useQuery<InsightResult>({
    queryKey: [...INSIGHT_KEY, question],
    queryFn: () =>
      apiFetch<InsightResult>('/insight', {
        method: 'POST',
        body: JSON.stringify({ question }),
      }),
    enabled: !!question,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

/**
 * MCP query hook (Do mode). Action-oriented — uses all MCP tools.
 */
export function useMcpQuery(prompt: string | null) {
  return useQuery<McpQueryResult>({
    queryKey: [...MCP_QUERY_KEY, prompt],
    queryFn: () =>
      apiFetch<McpQueryResult>('/insight/mcp-query', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      }),
    enabled: !!prompt,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

/**
 * Returns the most recent insight query key from cache (if any),
 * so the component can restore the input on remount.
 */
export function useLastInsightQuestion(): string | null {
  const client = useQueryClient();
  const queries = client.getQueriesData<InsightResult>({ queryKey: INSIGHT_KEY });
  if (!queries.length) return null;
  for (let i = queries.length - 1; i >= 0; i--) {
    const [key, data] = queries[i];
    if (data && key[1]) return key[1] as string;
  }
  return null;
}

/**
 * Returns the most recent mcp-query prompt from cache (if any).
 */
export function useLastMcpQueryPrompt(): string | null {
  const client = useQueryClient();
  const queries = client.getQueriesData<McpQueryResult>({ queryKey: MCP_QUERY_KEY });
  if (!queries.length) return null;
  for (let i = queries.length - 1; i >= 0; i--) {
    const [key, data] = queries[i];
    if (data && key[1]) return key[1] as string;
  }
  return null;
}
