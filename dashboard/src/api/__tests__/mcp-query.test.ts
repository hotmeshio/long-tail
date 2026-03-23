import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useSubmitMcpQuery, useMcpQueryJobs, useMcpQueryExecution } from '../mcp-query';

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
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
    queryClient,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('useSubmitMcpQuery', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should POST with wait:false and return workflow_id', async () => {
    const mockResponse = { workflow_id: 'mcp-query-123', status: 'started', prompt: 'test' };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockResponse));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSubmitMcpQuery(), { wrapper });

    const data = await result.current.mutateAsync({ prompt: 'test prompt' });

    expect(data.workflow_id).toBe('mcp-query-123');
    expect(data.status).toBe('started');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/insight/mcp-query');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.wait).toBe(false);
    expect(body.prompt).toBe('test prompt');
  });

  it('should include tags when provided', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ workflow_id: 'x', status: 'started', prompt: 'test' }));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useSubmitMcpQuery(), { wrapper });

    await result.current.mutateAsync({ prompt: 'test', tags: ['browser'] });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.tags).toEqual(['browser']);
  });
});

describe('useMcpQueryJobs', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch jobs filtered by entity=mcpQuery', async () => {
    const mockJobs = { jobs: [], total: 0 };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockJobs));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMcpQueryJobs({ limit: 10 }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('entity=mcpQuery');
    expect(url).toContain('sort_by=created_at');
    expect(url).toContain('order=desc');
  });
});

describe('useMcpQueryExecution', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not fetch when workflowId is undefined', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMcpQueryExecution(undefined), { wrapper });

    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should fetch execution for a given workflowId', async () => {
    const mockExecution = { workflow_id: 'mcp-query-123', status: 'completed', events: [] };
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockExecution));

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useMcpQueryExecution('mcp-query-123'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('mcp-query-123');
  });
});
