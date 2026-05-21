import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useTopics, useTopic, type TopicCatalogEntry, type TopicDetail } from '../topics';

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

const mockTopic: TopicCatalogEntry = {
  topic: 'task.created',
  description: 'A new task has been created.',
  category: 'task',
  source: 'system',
  tags: ['lifecycle', 'core'],
  subscriber_count: 2,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockDetail: TopicDetail = {
  ...mockTopic,
  payload_schema: { type: 'object', properties: { taskId: { type: 'string' } } },
  example_payload: { taskId: 'tsk-001' },
  subscribers: [
    { id: 's1', agent_id: 'a1', agent_name: 'watcher', topic: 'task.*', reaction_type: 'durable' },
  ],
};

describe('useTopics', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches topics list', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ topics: [mockTopic], total: 1 }));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTopics(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!.topics).toHaveLength(1);
    expect(result.current.data!.total).toBe(1);
  });

  it('passes category filter as query param', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ topics: [], total: 0 }));
    const { wrapper } = createWrapper();
    renderHook(() => useTopics({ category: 'task' }), { wrapper });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('category=task');
  });

  it('passes search filter as query param', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ topics: [], total: 0 }));
    const { wrapper } = createWrapper();
    renderHook(() => useTopics({ search: 'workflow' }), { wrapper });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('search=workflow');
  });
});

describe('useTopic', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches topic detail with encoded topic name', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(mockDetail));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTopic('task.created'), { wrapper });

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!.topic).toBe('task.created');
    expect(result.current.data!.subscribers).toHaveLength(1);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('/topics/by-name/');
  });

  it('does not fetch when topic is null', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useTopic(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
