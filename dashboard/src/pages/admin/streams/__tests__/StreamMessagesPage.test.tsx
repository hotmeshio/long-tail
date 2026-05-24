import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

import { StreamMessagesPage } from '../StreamMessagesPage';

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
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, { initialEntries: ['/admin/streams'] }, children),
    );
}

const MOCK_APPS = { apps: [{ appId: 'durable', version: '1.0.0' }] };

const MOCK_MESSAGES = {
  messages: [
    {
      id: '42',
      source: 'worker',
      stream_name: 'hmsh:durable:w:default',
      message: '{"type":"WORKER"}',
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
    {
      id: '41',
      source: 'worker',
      stream_name: 'hmsh:durable:w:other',
      message: '{"type":"RESPONSE"}',
      status: 'pending',
      created_at: '2026-05-23T14:29:00.000Z',
      reserved_at: null,
      reserved_by: null,
      expired_at: null,
      dead_lettered_at: null,
      priority: 1,
      visible_at: '2026-05-23T14:29:00.000Z',
      retry_attempt: 0,
      max_retry_attempts: 3,
      workflow_name: 'my-workflow',
      jid: 'job-124',
      aid: 'respond',
      dad: '',
      msg_type: 'RESPONSE',
      topic: 'default',
    },
  ],
  total: 2,
};

/** Route fetch calls to the right mock response based on URL path */
function mockApiFetch() {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/controlplane/apps')) return jsonResponse(MOCK_APPS);
    if (url.includes('/controlplane/stream-messages')) return jsonResponse(MOCK_MESSAGES);
    return jsonResponse({});
  });
}

function mockEmptyFetch() {
  fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/controlplane/apps')) return jsonResponse(MOCK_APPS);
    if (url.includes('/controlplane/stream-messages')) return jsonResponse({ messages: [], total: 0 });
    return jsonResponse({});
  });
}

describe('StreamMessagesPage', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders page header', () => {
    mockApiFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Stream Messages')).toBeDefined();
  });

  it('renders filter controls', () => {
    mockApiFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Namespace')).toBeDefined();
    expect(screen.getByText('Source')).toBeDefined();
    expect(screen.getByText('Status')).toBeDefined();
  });

  it('renders stream names after loading', async () => {
    mockApiFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    expect(await screen.findByText('hmsh:durable:w:default')).toBeDefined();
    expect(screen.getByText('hmsh:durable:w:other')).toBeDefined();
  });

  it('renders status labels', async () => {
    mockApiFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    await screen.findByText('hmsh:durable:w:default');
    // "Processed" appears in both the filter dropdown and the table row
    expect(screen.getAllByText('Processed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2);
  });

  it('renders message type column', async () => {
    mockApiFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    await screen.findByText('hmsh:durable:w:default');
    expect(screen.getByText('WORKER')).toBeDefined();
    expect(screen.getByText('RESPONSE')).toBeDefined();
  });

  it('shows empty state when no messages', async () => {
    mockEmptyFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    const empty = await screen.findByText('No stream messages found');
    expect(empty).toBeDefined();
  });

  it('renders table column headers after data loads', async () => {
    mockApiFetch();
    render(<StreamMessagesPage />, { wrapper: createWrapper() });
    await screen.findByText('hmsh:durable:w:default');
    // "Stream" appears as both the filter label and column header
    expect(screen.getAllByText('Stream').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Created')).toBeDefined();
    expect(screen.getByText('Reserved')).toBeDefined();
    expect(screen.getByText('Pri')).toBeDefined();
    expect(screen.getByText('Retries')).toBeDefined();
  });
});
