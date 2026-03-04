import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

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

const INSIGHT_KEY = ['insight'] as const;

/**
 * Query-based insight hook. The result is cached by TanStack Query,
 * so navigating away and hitting back restores the question + answer.
 * Submitting a new question replaces the cached result.
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
 * Returns the most recent insight query key from cache (if any),
 * so the component can restore the input on remount.
 */
export function useLastInsightQuestion(): string | null {
  const client = useQueryClient();
  const queries = client.getQueriesData<InsightResult>({ queryKey: INSIGHT_KEY });
  if (!queries.length) return null;
  // Most recent successful query
  for (let i = queries.length - 1; i >= 0; i--) {
    const [key, data] = queries[i];
    if (data && key[1]) return key[1] as string;
  }
  return null;
}
