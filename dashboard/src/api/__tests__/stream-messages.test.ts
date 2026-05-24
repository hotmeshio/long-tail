import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import { useStreamMessages } from '../stream-messages';

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

const MOCK_RESPONSE = {
  messages: [
    {
      id: '42',
      source: 'worker',
      stream_name: 'hmsh:durable:w:default',
      message: '{"type":"WORKER","metadata":{}}',
      status: 'processed',
      created_at: '2026-05-23T14:30:00.000Z',
      reserved_at: '2026-05-23T14:30:01.000Z',
      reserved_by: 'worker-abc',
      expired_at: '2026-05-23T14:30:02.000Z',
      dead_lettered_at: null,
      priority: 0,
      visible_at: '2026-05-23T14:30:00.000Z',
      retry_attempt: 0,
      max_retry_attempts: 3,
      workflow_name: 'my-workflow',
      jid: 'job-123',
      aid: 'greet',
      dad: '',
      msg_type: 'WORKER',
      topic: 'default',
    },
  ],
  total: 1,
};

describe('useStreamMessages', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('fetches stream messages', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(MOCK_RESPONSE));
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStreamMessages({ namespace: 'durable', source: 'worker' }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!.messages).toHaveLength(1);
    expect(result.current.data!.total).toBe(1);
  });

  it('passes namespace and source as required query params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ messages: [], total: 0 }));
    const { wrapper } = createWrapper();
    renderHook(
      () => useStreamMessages({ namespace: 'durable', source: 'engine' }),
      { wrapper },
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('namespace=durable');
    expect(url).toContain('source=engine');
  });

  it('passes optional filters as query params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ messages: [], total: 0 }));
    const { wrapper } = createWrapper();
    renderHook(
      () => useStreamMessages({
        namespace: 'durable',
        source: 'worker',
        status: 'pending',
        stream_name: 'hmsh:durable',
        sort_by: 'priority',
        order: 'asc',
      }),
      { wrapper },
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('status=pending');
    expect(url).toContain('stream_name=hmsh');
    expect(url).toContain('sort_by=priority');
    expect(url).toContain('order=asc');
  });

  it('passes pagination params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ messages: [], total: 0 }));
    const { wrapper } = createWrapper();
    renderHook(
      () => useStreamMessages({ namespace: 'durable', source: 'worker', limit: 10, offset: 20 }),
      { wrapper },
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=20');
  });

  it('does not fetch when namespace is empty', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(
      () => useStreamMessages({ namespace: '', source: 'worker' }),
      { wrapper },
    );
    expect(result.current.isFetching).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
