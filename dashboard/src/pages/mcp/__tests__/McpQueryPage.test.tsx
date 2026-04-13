import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/mcp-query', () => ({
  useMcpQueryJobs: vi.fn(),
  useSubmitMcpQuery: vi.fn(),
  useSubmitMcpQueryRouted: vi.fn(),
}));

vi.mock('../../../hooks/useNatsEvents', () => ({
  useWorkflowListEvents: vi.fn(),
}));

import { McpQueryPage } from '../McpQueryPage';
import { useMcpQueryJobs, useSubmitMcpQuery, useSubmitMcpQueryRouted } from '../../../api/mcp-query';

const now = new Date().toISOString();

const mockJobs = {
  jobs: [
    { workflow_id: 'mcp-query-1', entity: 'mcpQuery', status: 'completed', is_live: false, created_at: now, updated_at: now },
    { workflow_id: 'mcp-query-2', entity: 'mcpQuery', status: 0, is_live: true, created_at: now, updated_at: now },
    { workflow_id: 'triage-abc', entity: 'mcpTriage', status: 'completed', is_live: false, created_at: now, updated_at: now },
  ],
  total: 3,
};

const mockMutation = {
  mutateAsync: vi.fn().mockResolvedValue({ workflow_id: 'new-id', status: 'started', prompt: 'test' }),
  isPending: false,
  isError: false,
  error: null,
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
  vi.mocked(useSubmitMcpQuery).mockReturnValue({ ...mockMutation } as any);
  vi.mocked(useSubmitMcpQueryRouted).mockReturnValue({ ...mockMutation } as any);
});

describe('McpQueryPage', () => {
  it('renders page header', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('Pipeline Designer')).toBeInTheDocument();
  });

  it('renders submit form with textarea and button', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByPlaceholderText(/describe what you want/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /design pipeline/i })).toBeInTheDocument();
  });

  it('disables button when textarea is empty', () => {
    render(<McpQueryPage />, { wrapper });
    const btn = screen.getByRole('button', { name: /design pipeline/i });
    expect(btn).toBeDisabled();
  });

  it('enables button when textarea has content', () => {
    render(<McpQueryPage />, { wrapper });
    const textarea = screen.getByPlaceholderText(/describe what you want/i);
    fireEvent.change(textarea, { target: { value: 'test prompt' } });
    const btn = screen.getByRole('button', { name: /design pipeline/i });
    expect(btn).not.toBeDisabled();
  });

  it('renders job rows including triage', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('mcp-query-1')).toBeInTheDocument();
    expect(screen.getByText('mcp-query-2')).toBeInTheDocument();
    expect(screen.getByText('triage-abc')).toBeInTheDocument();
  });

  it('shows workflow type pills', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getAllByText('mcpQuery').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('mcpTriage').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Direct checkbox (default checked)', () => {
    render(<McpQueryPage />, { wrapper });
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
    expect(screen.getByText('Force discovery')).toBeInTheDocument();
  });

  it('shows empty state when no jobs', () => {
    vi.mocked(useMcpQueryJobs).mockReturnValue({ data: { jobs: [], total: 0 }, isLoading: false } as any);
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('No pipeline runs yet')).toBeInTheDocument();
  });

  it('renders status filter', () => {
    render(<McpQueryPage />, { wrapper });
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });
});
