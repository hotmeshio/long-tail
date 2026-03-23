import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface McpQueryResult {
  title: string;
  summary: string;
  result: any;
  tool_calls_made: number;
  prompt: string;
  workflow_id: string;
  duration_ms: number;
}

const MCP_QUERY_KEY = ['mcp-query'] as const;

/**
 * MCP query hook. Action-oriented — uses all MCP tools.
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
