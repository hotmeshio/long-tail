import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/mcp-query', () => ({
  useMcpQueryJobs: vi.fn(),
  useSubmitMcpQuery: vi.fn(),
}));

vi.mock('../../../hooks/useNatsEvents', () => ({
  useWorkflowListEvents: vi.fn(),
}));

import { McpQueryPage } from '../McpQueryPage';
import { useMcpQueryJobs, useSubmitMcpQuery } from '../../../api/mcp-query';

const now = new Date().toISOString();

const mockJobs = {
  jobs: [
    { workflow_id: 'mcp-query-1', entity: 'mcpQuery', status: 'completed', is_live: false, created_at: now, updated_at: now },
    { workflow_id: 'mcp-query-2', entity: 'mcpQuery', status: 0, is_live: true, created_at: now, updated_at: now },
  ],
  total: 2,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(useMcpQueryJobs).mockReturnValue({ data: mockJobs, isLoading: false } as any);
  vi.mocked(useSubmitMcpQuery).mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({ workflow_id: 'new-id', status: 'started', prompt: 'test' }),
    isPending: false,
    isError: false,
    error: null,
  } as any);
});

describe('McpQueryPage', () => {
  it('renders page header', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('Deterministic MCP')).toBeInTheDocument();
  });

  it('renders submit form with textarea and button', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByPlaceholderText(/describe what you want/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument();
  });

  it('disables Run button when textarea is empty', () => {
    render(<McpQueryPage />, { wrapper });
    const btn = screen.getByRole('button', { name: /run/i });
    expect(btn).toBeDisabled();
  });

  it('enables Run button when textarea has content', () => {
    render(<McpQueryPage />, { wrapper });
    const textarea = screen.getByPlaceholderText(/describe what you want/i);
    fireEvent.change(textarea, { target: { value: 'test prompt' } });
    const btn = screen.getByRole('button', { name: /run/i });
    expect(btn).not.toBeDisabled();
  });

  it('renders job rows', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('mcp-query-1')).toBeInTheDocument();
    expect(screen.getByText('mcp-query-2')).toBeInTheDocument();
  });

  it('shows empty state when no jobs', () => {
    vi.mocked(useMcpQueryJobs).mockReturnValue({ data: { jobs: [], total: 0 }, isLoading: false } as any);
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('No queries yet')).toBeInTheDocument();
  });

  it('renders status filter', () => {
    render(<McpQueryPage />, { wrapper });
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });
});
