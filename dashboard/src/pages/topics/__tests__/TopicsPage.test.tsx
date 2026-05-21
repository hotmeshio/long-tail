import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

import { TopicsPage } from '../TopicsPage';

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
      createElement(MemoryRouter, { initialEntries: ['/topics'] }, children),
    );
}

const MOCK_TOPICS = {
  topics: [
    {
      topic: 'task.created',
      description: 'A new task has been created.',
      category: 'task',
      source: 'system',
      tags: ['lifecycle'],
      subscriber_count: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      topic: 'workflow.failed',
      description: 'A workflow execution has failed.',
      category: 'workflow',
      source: 'system',
      tags: ['lifecycle', 'error'],
      subscriber_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  total: 2,
};

describe('TopicsPage', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders page header', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(MOCK_TOPICS));
    render(<TopicsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Topic Catalog')).toBeDefined();
  });

  it('renders topic names after loading', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(MOCK_TOPICS));
    render(<TopicsPage />, { wrapper: createWrapper() });

    const taskTopic = await screen.findByText('task.created');
    expect(taskTopic).toBeDefined();

    const workflowTopic = await screen.findByText('workflow.failed');
    expect(workflowTopic).toBeDefined();
  });

  it('renders category pills', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(MOCK_TOPICS));
    render(<TopicsPage />, { wrapper: createWrapper() });

    await screen.findByText('task.created');
    expect(screen.getByText('task')).toBeDefined();
    expect(screen.getByText('workflow')).toBeDefined();
  });

  it('renders descriptions', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(MOCK_TOPICS));
    render(<TopicsPage />, { wrapper: createWrapper() });

    await screen.findByText('task.created');
    expect(screen.getByText('A new task has been created.')).toBeDefined();
  });

  it('shows empty state when no topics', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ topics: [], total: 0 }));
    render(<TopicsPage />, { wrapper: createWrapper() });

    const empty = await screen.findByText('No topics registered yet');
    expect(empty).toBeDefined();
  });

  it('renders category filter', () => {
    fetchSpy.mockResolvedValue(jsonResponse(MOCK_TOPICS));
    render(<TopicsPage />, { wrapper: createWrapper() });
    expect(screen.getByText('Category')).toBeDefined();
  });
});
