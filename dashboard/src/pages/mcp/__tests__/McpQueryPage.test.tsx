import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/mcp-query', () => ({
  useMcpQueryJobs: vi.fn(),
}));

vi.mock('../../../hooks/useNatsEvents', () => ({
  useWorkflowListEvents: vi.fn(),
}));

import { McpQueryPage } from '../McpQueryPage';
import { useMcpQueryJobs } from '../../../api/mcp-query';

const now = new Date().toISOString();

const mockJobs = {
  jobs: [
    { workflow_id: 'mcp-query-1', entity: 'mcpQuery', status: 'completed', is_live: false, created_at: now, updated_at: now },
    { workflow_id: 'mcp-query-2', entity: 'mcpQuery', status: 0, is_live: true, created_at: now, updated_at: now },
    { workflow_id: 'triage-abc', entity: 'mcpTriage', status: 'completed', is_live: false, created_at: now, updated_at: now },
  ],
  total: 3,
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
});

describe('McpQueryPage', () => {
  it('renders page header', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('Pipeline Designer')).toBeInTheDocument();
  });

  it('renders Design Pipeline button', () => {
    render(<McpQueryPage />, { wrapper });
    expect(screen.getByText('Design Pipeline')).toBeInTheDocument();
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
