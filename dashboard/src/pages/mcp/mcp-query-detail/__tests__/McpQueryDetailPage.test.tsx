import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../../api/mcp-query', () => ({
  useMcpQueryExecution: vi.fn(),
  useMcpQueryResult: vi.fn(),
  useYamlWorkflowForSource: vi.fn(),
  useDescribeMcpQuery: vi.fn(),
}));


vi.mock('../../../../api/yaml-workflows', () => ({
  useCreateYamlWorkflow: vi.fn(),
  useDeployYamlWorkflow: vi.fn(),
  useActivateYamlWorkflow: vi.fn(),
  useInvokeYamlWorkflow: vi.fn(),
  useYamlWorkflowAppIds: vi.fn(),
  useYamlWorkflows: vi.fn(),
}));

vi.mock('../../../../api/mcp-runs', () => ({
  useMcpRuns: vi.fn(),
}));

vi.mock('../../../../hooks/useNatsEvents', () => ({
  useWorkflowDetailEvents: vi.fn(),
}));

vi.mock('../DeployPanel', () => ({
  DeployPanel: () => <div data-testid="deploy-panel">DeployPanel</div>,
}));

vi.mock('../TestPanel', () => ({
  TestPanel: () => <div data-testid="test-panel">TestPanel</div>,
}));

import { McpQueryDetailPage } from '../McpQueryDetailPage';
import { useMcpQueryExecution, useMcpQueryResult, useYamlWorkflowForSource, useDescribeMcpQuery } from '../../../../api/mcp-query';
import { useCreateYamlWorkflow, useDeployYamlWorkflow, useActivateYamlWorkflow, useInvokeYamlWorkflow, useYamlWorkflowAppIds } from '../../../../api/yaml-workflows';
import { useMcpRuns } from '../../../../api/mcp-runs';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mcp/queries/mcp-query-123']}>
        <Routes>
          <Route path="/mcp/queries/:workflowId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const mutationMock = { mutateAsync: vi.fn(), isPending: false, isError: false, error: null };

beforeEach(() => {
  vi.mocked(useCreateYamlWorkflow).mockReturnValue(mutationMock as any);
  vi.mocked(useDeployYamlWorkflow).mockReturnValue(mutationMock as any);
  vi.mocked(useActivateYamlWorkflow).mockReturnValue(mutationMock as any);
  vi.mocked(useYamlWorkflowAppIds).mockReturnValue({ data: { app_ids: ['longtail'] } } as any);
  vi.mocked(useYamlWorkflowForSource).mockReturnValue({ data: undefined } as any);
  vi.mocked(useDescribeMcpQuery).mockReturnValue({ data: undefined } as any);
  vi.mocked(useInvokeYamlWorkflow).mockReturnValue(mutationMock as any);
  vi.mocked(useMcpRuns).mockReturnValue({ data: { jobs: [], total: 0 } } as any);
});

describe('McpQueryDetailPage', () => {
  it('renders page header and wizard steps', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({ data: undefined, isLoading: true } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({ data: undefined } as any);

    render(<McpQueryDetailPage />, { wrapper });
    expect(screen.getByText('Deterministic MCP Wizard')).toBeInTheDocument();
    // All 5 wizard step labels
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('shows running state on step 1', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'running', events: [], duration_ms: null },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({ data: undefined } as any);

    render(<McpQueryDetailPage />, { wrapper });
    expect(screen.getByText(/starting query/i)).toBeInTheDocument();
  });

  it('auto-advances to step 2 (review) when result exists', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'completed', events: [], duration_ms: 5000, start_time: new Date().toISOString() },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({
      data: { result: { data: { title: 'All Pages Captured', summary: '15 screenshots' } } },
    } as any);

    render(<McpQueryDetailPage />, { wrapper });
    // Auto-advances to step 2 (review) — shows execution timeline (SwimlaneTimeline)
    // Step 2 should be active in the wizard
    const stepButtons = screen.getAllByRole('button');
    const step2 = stepButtons.find((b) => b.textContent === '2');
    expect(step2?.className).toContain('bg-accent');
  });

  it('shows compile step with description input and configure button', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'completed', events: [], duration_ms: 5000 },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({
      data: { result: { data: { title: 'Done', summary: 'Done' } } },
    } as any);
    vi.mocked(useYamlWorkflowForSource).mockReturnValue({ data: { workflows: [] } } as any);

    render(<McpQueryDetailPage />, { wrapper });
    // Navigate to step 3 (compile)
    fireEvent.click(screen.getByText('3'));
    expect(screen.getByRole('button', { name: /create profile/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/describe what this workflow does/i)).toBeInTheDocument();
    // Should have namespace and tool name inputs
    expect(screen.getByPlaceholderText(/e\.g\. longtail/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. auth-screenshot/i)).toBeInTheDocument();
  });

  it('shows deploy step when YAML workflow exists in draft', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'completed', events: [], duration_ms: 5000 },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({
      data: { result: { data: { title: 'Done' } } },
    } as any);
    vi.mocked(useYamlWorkflowForSource).mockReturnValue({
      data: { workflows: [{ id: 'y1', name: 'test-wf', status: 'draft', graph_topic: 't' }] },
    } as any);

    render(<McpQueryDetailPage />, { wrapper });
    expect(screen.getByTestId('deploy-panel')).toBeInTheDocument();
  });

  it('shows test step when workflow is active', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'completed', events: [], duration_ms: 5000 },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({
      data: { result: { data: { title: 'Done' } } },
    } as any);
    vi.mocked(useYamlWorkflowForSource).mockReturnValue({
      data: { workflows: [{ id: 'y1', name: 'test-wf', status: 'active', graph_topic: 't' }] },
    } as any);

    render(<McpQueryDetailPage />, { wrapper });
    expect(screen.getByTestId('test-panel')).toBeInTheDocument();
  });

  it('shows deterministic badge', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'completed', events: [], duration_ms: 3000 },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({
      data: { result: { data: { title: 'Done', discovery: { method: 'compiled-workflow', confidence: 0.92 } } } },
    } as any);

    render(<McpQueryDetailPage />, { wrapper });
    expect(screen.getByText(/deterministic.*92%/i)).toBeInTheDocument();
  });

  it('wizard steps are clickable for reached steps', () => {
    vi.mocked(useMcpQueryExecution).mockReturnValue({
      data: { status: 'completed', events: [], duration_ms: 5000 },
    } as any);
    vi.mocked(useMcpQueryResult).mockReturnValue({
      data: { result: { data: { title: 'Done', summary: 'Done' } } },
    } as any);

    render(<McpQueryDetailPage />, { wrapper });
    // Step 3 (compile) should be reachable
    fireEvent.click(screen.getByText('3'));
    expect(screen.getByPlaceholderText(/e\.g\. longtail/i)).toBeInTheDocument();
    // Step 2 should be reachable (go back to review)
    fireEvent.click(screen.getByText('2'));
    // Should not show compile form anymore
    expect(screen.queryByPlaceholderText(/e\.g\. longtail/i)).not.toBeInTheDocument();
  });
});
