import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useMcpQuery, useLastMcpQueryPrompt } from '../insight';
import type { McpQueryResult } from '../insight';

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

const mockResult: McpQueryResult = {
  title: 'Test',
  summary: 'Test summary',
  result: { path: '/screenshots/test.png' },
  tool_calls_made: 3,
  prompt: 'take a screenshot',
  workflow_id: 'mcp-test',
  duration_ms: 2000,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('useMcpQuery', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when prompt is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMcpQuery(null), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should fetch when prompt is provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResult));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMcpQuery('take a screenshot'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/insight/mcp-query');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      prompt: 'take a screenshot',
    });
  });

  it('should return the parsed result', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResult));

    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useMcpQuery('take a screenshot'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());

    expect(result.current.data?.title).toBe('Test');
    expect(result.current.data?.summary).toBe('Test summary');
    expect(result.current.data?.tool_calls_made).toBe(3);
  });

  it('should not fetch for empty string', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMcpQuery(''), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('useLastMcpQueryPrompt', () => {
  it('should return null when no cached queries exist', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useLastMcpQueryPrompt(), { wrapper });

    expect(result.current).toBeNull();
  });

  it('should return the last successful prompt from cache', async () => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResult));

    const { wrapper } = createWrapper();

    // First, run a query to populate the cache
    const { result: queryResult } = renderHook(
      () => useMcpQuery('Cached prompt'),
      { wrapper },
    );

    await waitFor(() => expect(queryResult.current.data).toBeTruthy());

    // Now check useLastMcpQueryPrompt
    const { result: lastResult } = renderHook(
      () => useLastMcpQueryPrompt(),
      { wrapper },
    );

    expect(lastResult.current).toBe('Cached prompt');

    vi.restoreAllMocks();
  });
});
