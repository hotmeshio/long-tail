import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockExecution = {
  workflow_id: 'mcpQuery-abc123def456',
  workflow_type: 'long-tail-system-mcpQuery',
  task_queue: 'long-tail-system',
  status: 'completed',
  start_time: '2025-06-01T10:00:00Z',
  close_time: '2025-06-01T10:00:05Z',
  duration_ms: 5000,
  result: { answer: 42 },
  events: [
    {
      event_id: 1,
      event_type: 'workflow_execution_started',
      category: 'workflow',
      event_time: '2025-06-01T10:00:00Z',
      duration_ms: null,
      is_system: false,
      attributes: { kind: 'started', input: { query: 'test' } },
    },
    {
      event_id: 2,
      event_type: 'activity_task_completed',
      category: 'activity',
      event_time: '2025-06-01T10:00:02Z',
      duration_ms: 2000,
      is_system: false,
      attributes: { kind: 'completed', activity_type: 'doSomething' },
    },
    {
      event_id: 3,
      event_type: 'workflow_execution_completed',
      category: 'workflow',
      event_time: '2025-06-01T10:00:05Z',
      duration_ms: null,
      is_system: false,
      attributes: { kind: 'completed' },
    },
  ],
  summary: {
    total_events: 3,
    activities: { total: 1, completed: 1, failed: 0, system: 0, user: 1 },
    child_workflows: { total: 0, completed: 0, failed: 0 },
    timers: 0,
    signals: 0,
  },
};

const mockRefetch = vi.fn();

vi.mock('../../../api/workflows', () => ({
  useWorkflowExecution: vi.fn(),
  useTerminateWorkflow: () => ({ mutate: vi.fn(), error: null }),
}));

vi.mock('../../../api/tasks', () => ({
  useTaskByWorkflowId: () => ({ data: null }),
  useChildTasks: () => ({ data: { tasks: [] } }),
}));

vi.mock('../../../api/escalations', () => ({
  useEscalationsByWorkflowId: () => ({ data: { escalations: [] } }),
}));

vi.mock('../../../hooks/useEventHooks', () => ({
  useWorkflowDetailEvents: vi.fn(),
}));

vi.mock('../../../hooks/useCollapsedSections', () => ({
  useCollapsedSections: () => ({
    isCollapsed: () => false,
    toggle: vi.fn(),
  }),
}));

import { useWorkflowExecution } from '../../../api/workflows';
import { WorkflowExecutionPage } from '../WorkflowExecutionPage';

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage(path = '/workflows/executions/mcpQuery-abc123def456') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/workflows/executions/:workflowId" element={<WorkflowExecutionPage />} />
          <Route path="/workflows/durable/:workflowId" element={<WorkflowExecutionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WorkflowExecutionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton when data is loading', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
      isFetching: true,
    } as any);

    renderPage();
    // Loading skeleton has animate-pulse divs, no page header text
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('renders not-found state when execution is missing', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText('Execution not found')).toBeInTheDocument();
    expect(screen.getByText(/Workflows/)).toBeInTheDocument();
  });

  it('renders error state with message', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Something went wrong'),
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText('Unable to load execution')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders expired execution message', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('This workflow has expired'),
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText('Execution data is no longer available')).toBeInTheDocument();
  });

  it('renders execution header with workflow ID and status', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: mockExecution,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    // workflow_id appears in both header h2 and Run ID field
    expect(screen.getAllByText('mcpQuery-abc123def456').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders page header as Durable Execution for durable path', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: mockExecution,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage('/workflows/durable/mcpQuery-abc123def456');
    expect(screen.getByText('Durable Execution')).toBeInTheDocument();
  });

  it('renders collapsible sections for details, timeline, and events', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: mockExecution,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText('Details')).toBeInTheDocument();
    // "Execution Timeline" may appear in both section header and sub-component
    expect(screen.getAllByText('Execution Timeline').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Events').length).toBeGreaterThanOrEqual(1);
  });

  it('renders execution metadata fields', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: mockExecution,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText('Workflow Type')).toBeInTheDocument();
    expect(screen.getByText('Task Queue')).toBeInTheDocument();
    expect(screen.getByText('History Size')).toBeInTheDocument();
    expect(screen.getByText('3 events')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
  });

  it('renders actions button', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: mockExecution,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('does not show compile-into-pipeline link when no MCP tool calls', () => {
    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: mockExecution,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.queryByText(/Compile into Pipeline/)).not.toBeInTheDocument();
  });

  it('shows compile-into-pipeline link when execution has MCP tool calls', () => {
    const executionWithMcp = {
      ...mockExecution,
      events: [
        ...mockExecution.events.slice(0, 1),
        {
          event_id: 2,
          event_type: 'activity_task_completed',
          category: 'activity',
          event_time: '2025-06-01T10:00:02Z',
          duration_ms: 2000,
          is_system: false,
          attributes: { kind: 'completed', activity_type: 'callMcpTool' },
        },
        ...mockExecution.events.slice(2),
      ],
    };

    vi.mocked(useWorkflowExecution).mockReturnValue({
      data: executionWithMcp,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    } as any);

    renderPage();
    expect(screen.getByText(/Compile into Pipeline/)).toBeInTheDocument();
  });
});
