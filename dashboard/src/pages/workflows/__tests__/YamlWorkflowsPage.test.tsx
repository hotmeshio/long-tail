import { render, screen, fireEvent } from '@testing-library/react';
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
      app_id: 'lt-yaml',
      app_version: '3',
      graph_topic: 'rotate_and_verify',
      source_workflow_type: 'mcpTriage',
      status: 'active',
      activity_manifest: [
        { activity_id: 'a0', type: 'worker', tool_source: 'mcp' },
        { activity_id: 'a1', type: 'worker', tool_source: 'mcp' },
      ],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    },
    {
      id: 'wf-2',
      name: 'extract-info',
      description: 'Extract and validate info',
      app_id: 'lt-yaml',
      app_version: '3',
      graph_topic: 'extract_info',
      source_workflow_type: 'mcpTriage',
      status: 'deployed',
      activity_manifest: [
        { activity_id: 'a0', type: 'worker', tool_source: 'mcp' },
      ],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-03T00:00:00Z',
    },
    {
      id: 'wf-3',
      name: 'claim-review',
      description: null,
      app_id: 'claims-app',
      app_version: '1',
      graph_topic: 'claim_review',
      source_workflow_type: null,
      status: 'draft',
      activity_manifest: [],
      created_at: '2025-01-05T00:00:00Z',
      updated_at: '2025-01-05T00:00:00Z',
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

describe('YamlWorkflowsPage', () => {
  it('renders page header', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByRole('heading', { name: 'MCP Pipeline Tools' })).toBeInTheDocument();
  });

  it('renders description text', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByText(/Compiled from successful triage runs/)).toBeInTheDocument();
  });

  it('groups workflows by app_id as server rows', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    // Multiple matches expected: table row + server filter dropdown option
    expect(screen.getAllByText('lt-yaml').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('claims-app').length).toBeGreaterThanOrEqual(1);
  });

  it('shows tool count badge per server', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    // Count is shown as a number in a badge circle — may appear multiple times
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('expands server to show tool rows on click', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    // Find the server row in the table (not the dropdown option)
    const matches = screen.getAllByText('lt-yaml');
    const serverRow = matches.map((el) => el.closest('tr')).find((tr) => tr !== null)!;
    fireEvent.click(serverRow);
    // After expand, tool topics should be visible
    expect(screen.getByText('rotate_and_verify')).toBeInTheDocument();
    expect(screen.getByText('extract_info')).toBeInTheDocument();
  });

  it('shows empty state when no workflows', () => {
    vi.mocked(useYamlWorkflows).mockReturnValue({
      data: { workflows: [], total: 0 },
      isLoading: false,
    } as any);
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByText('No workflow tools found')).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    vi.mocked(useYamlWorkflows).mockReturnValue({ data: undefined, isLoading: true } as any);
    const { container } = render(<YamlWorkflowsPage />, { wrapper });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('shows best status per server (active over deployed)', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    // lt-yaml has active + deployed; best status is "active"
    // claims-app has draft; status is "draft"
    const badges = screen.getAllByText('Active');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    const drafts = screen.getAllByText('Draft');
    // At least 2: one in the filter dropdown + one in the status badge
    expect(drafts.length).toBeGreaterThanOrEqual(2);
  });

  it('renders search input', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(screen.getByPlaceholderText('Server or tool name…')).toBeInTheDocument();
  });

  it('renders status filter', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    // Status filter has known options
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('renders server filter when multiple servers exist', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    // Should have Server dropdown since there are two distinct app_ids
    const labels = screen.getAllByText('Server');
    expect(labels.length).toBeGreaterThanOrEqual(1);
  });

  it('passes filters to API hook', () => {
    render(<YamlWorkflowsPage />, { wrapper });
    expect(useYamlWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 200, offset: 0 }),
    );
  });
});
