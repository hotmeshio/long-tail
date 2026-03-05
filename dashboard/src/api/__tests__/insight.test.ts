import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useInsightQuery, useLastInsightQuestion } from '../insight';
import type { InsightResult } from '../insight';

// ── Mock fetch ────────────────────────────────────────────────────────────

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
    queryClient,
  };
}

const mockResult: InsightResult = {
  title: 'Test',
  summary: 'Test summary',
  sections: [],
  metrics: [],
  tool_calls_made: 1,
  query: 'test question',
  workflow_id: 'wf-test',
  duration_ms: 500,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('useInsightQuery', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when question is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInsightQuery(null), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should fetch when question is provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResult));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInsightQuery('How many tasks?'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/insight');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      question: 'How many tasks?',
    });
  });

  it('should return the parsed result', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResult));

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useInsightQuery('Show system health'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data?.title).toBe('Test');
    expect(result.current.data?.summary).toBe('Test summary');
    expect(result.current.data?.tool_calls_made).toBe(1);
  });

  it('should not fetch for empty string', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useInsightQuery(''), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('useLastInsightQuestion', () => {
  it('should return null when no cached queries exist', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLastInsightQuestion(), { wrapper });

    expect(result.current).toBeNull();
  });

  it('should return the last successful question from cache', async () => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResult));

    const { wrapper, queryClient } = createWrapper();

    // First, run a query to populate the cache
    const { result: queryResult } = renderHook(
      () => useInsightQuery('Cached question?'),
      { wrapper },
    );

    await waitFor(() => expect(queryResult.current.data).toBeTruthy());

    // Now check useLastInsightQuestion
    const { result: lastResult } = renderHook(
      () => useLastInsightQuestion(),
      { wrapper },
    );

    expect(lastResult.current).toBe('Cached question?');

    vi.restoreAllMocks();
  });
});
