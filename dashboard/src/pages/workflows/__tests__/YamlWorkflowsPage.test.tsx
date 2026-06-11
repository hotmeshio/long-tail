import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/yaml-workflows', () => ({
  useYamlWorkflows: vi.fn(),
}));

import { YamlWorkflowsPage } from '../YamlWorkflowsPage';
import { useYamlWorkflows } from '../../../api/yaml-workflows';

const mockWorkflows = {
  workflows: [
    {
      id: 'wf-1',
      name: 'rotate-and-verify',
      description: 'Rotate document and verify',
      app_id: 'graph',
      app_version: '3',
      content_version: 3,
      graph_topic: 'rotate_and_verify',
      status: 'active',
      activity_manifest: [],
    },
    {
      id: 'wf-2',
      name: 'extract-info',
      description: 'Extract and validate info',
      app_id: 'graph',
      app_version: '3',
      content_version: 2,
      graph_topic: 'extract_info',
      status: 'deployed',
      activity_manifest: [],
    },
    {
      id: 'wf-3',
      name: 'claim-review',
      description: null,
      app_id: 'claims',
      app_version: '1',
      content_version: 1,
      graph_topic: 'claim_review',
      status: 'draft',
      activity_manifest: [],
    },
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
  vi.mocked(useYamlWorkflows).mockReturnValue({ data: mockWorkflows, isLoading: false } as any);
});

describe('YamlWorkflowsPage (Configure)', () => {
  it('renders the Configure header', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByRole('heading', { name: 'Configure' })).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByText(/The compiled form of a durable workflow/)).toBeInTheDocument();
  });

  it('renders a flat row per flow (no app_id grouping)', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByText('rotate_and_verify')).toBeInTheDocument();
    expect(screen.getByText('extract_info')).toBeInTheDocument();
    expect(screen.getByText('claim_review')).toBeInTheDocument();
  });

  it('shows a namespace pill per flow', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getAllByText('graph').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('claims')).toBeInTheDocument();
  });

  it('shows status badges', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Draft').length).toBeGreaterThanOrEqual(2); // badge + filter option
  });

  it('shows empty state when no flows', () => {
    vi.mocked(useYamlWorkflows).mockReturnValue({
      data: { workflows: [], total: 0 },
      isLoading: false,
    } as any);
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByText('No graph flows yet')).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    vi.mocked(useYamlWorkflows).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<YamlWorkflowsPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders search input', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByPlaceholderText('Flow or namespace…')).toBeInTheDocument();
  });

  it('passes filters to the API hook', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(useYamlWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200, offset: 0 }),
    );
  });
});
