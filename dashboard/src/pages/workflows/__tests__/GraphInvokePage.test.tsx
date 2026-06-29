import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflows: vi.fn(),
}));

import { GraphInvokePage } from '../GraphInvokePage';
import { useYamlWorkflows } from '../../../api/yaml-workflows';

// Two flows → no auto-select, so the run panel isn't mounted in this smoke test.
const flows = {
  workflows: [
    { id: 'wf-1', graph_topic: 'hello_world', app_id: 'graph', description: 'Greets a name', status: 'active', cron_schedule: null },
    { id: 'wf-2', graph_topic: 'farewell', app_id: 'graph', description: 'Says goodbye', status: 'active', cron_schedule: null },
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
  vi.mocked(useYamlWorkflows).mockReturnValue({ data: flows, isLoading: false } as any);
});

describe('GraphInvokePage', () => {
  it('renders the flow selector with active flows', () => {
    render(<GraphInvokePage />, { wrapper });
    expect(screen.getByText('Graph Flows')).toBeInTheDocument();
    expect(screen.getByText('hello_world')).toBeInTheDocument();
    expect(screen.getByText('farewell')).toBeInTheDocument();
    expect(screen.getByText('Select a flow')).toBeInTheDocument();
  });

  it('queries only active flows', () => {
    render(<GraphInvokePage />, { wrapper });
    expect(useYamlWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('shows empty state when there are no active flows', () => {
    vi.mocked(useYamlWorkflows).mockReturnValue({ data: { workflows: [], total: 0 }, isLoading: false } as any);
    render(<GraphInvokePage />, { wrapper });
    expect(screen.getByText('No active graph flows')).toBeInTheDocument();
  });
});
