import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockConfigs = [
  {
    workflow_type: 'reviewContent',
    task_queue: 'long-tail-examples-reviewContent',
    invocable: true,
    description: 'Review user-generated content',
    default_role: 'reviewer',
    roles: ['reviewer', 'admin'],
    invocation_roles: ['admin'],
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
  },
  {
    workflow_type: 'processClaim',
    task_queue: 'long-tail-examples-processClaim',
    invocable: true,
    description: 'Process insurance claims',
    default_role: 'reviewer',
    roles: ['adjuster'],
    invocation_roles: [],
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: 'lt-system',
  },
];

const mockDiscovered = [
  { workflow_type: 'durableOnly', task_queue: 'durable-queue', tier: 'durable', active: true },
];

const mockCronEntries = [
  { workflow_type: 'reviewContent', active: true, cron_schedule: '0 * * * *' },
];

// ── API mocks ────────────────────────────────────────────────────────────────

let workflowConfigsOverride: { data: typeof mockConfigs | undefined; isLoading: boolean } | undefined;
let discoveredOverride: { data: typeof mockDiscovered | undefined; isLoading: boolean } | undefined;

vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: () => workflowConfigsOverride ?? ({ data: mockConfigs, isLoading: false }),
  useDiscoveredWorkflows: () => discoveredOverride ?? ({ data: mockDiscovered, isLoading: false }),
  useCronStatus: () => ({ data: mockCronEntries }),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
  useSetCronSchedule: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
  useJobs: () => ({ data: { jobs: [] }, isLoading: false }),
}));

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { username: 'testuser', displayName: 'Test User' },
    isSuperAdmin: false,
    hasRoleType: () => false,
  }),
}));

vi.mock('../../../../api/bots', () => ({
  useBots: () => ({ data: { bots: [] } }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderPage(initialEntries = ['/workflows/start']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <StartWorkflowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { StartWorkflowPage } from '../StartWorkflowPage';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StartWorkflowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowConfigsOverride = undefined;
    discoveredOverride = undefined;
  });

  it('renders page header', () => {
    renderPage();
    expect(screen.getByText('Invoke Workflow')).toBeInTheDocument();
  });

  it('renders mode toggle with Start Now and Schedule buttons', () => {
    renderPage();
    expect(screen.getByText('Start Now')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
  });

  it('renders workflow selector with all invocable workflows', () => {
    renderPage();
    expect(screen.getByText('Select Workflow')).toBeInTheDocument();
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    expect(screen.getByText('processClaim')).toBeInTheDocument();
  });

  it('includes discovered durable workflows in the selector', () => {
    renderPage();
    expect(screen.getByText('durableOnly')).toBeInTheDocument();
  });

  it('shows prompt to select a workflow when none is selected', () => {
    renderPage();
    expect(screen.getByText('Select a workflow to begin')).toBeInTheDocument();
  });

  it('shows loading skeleton when configs are loading', () => {
    workflowConfigsOverride = { data: undefined, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows loading skeleton when discovered workflows are loading', () => {
    discoveredOverride = { data: undefined, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows empty state when no invocable workflows exist', () => {
    workflowConfigsOverride = { data: [], isLoading: false };
    discoveredOverride = { data: [], isLoading: false };
    renderPage();
    expect(screen.getByText('No invocable workflows')).toBeInTheDocument();
    expect(screen.getByText(/Mark workflows as invocable/)).toBeInTheDocument();
  });

  it('shows the StartNowPanel when a workflow is selected with mode=now', () => {
    renderPage(['/workflows/start?type=reviewContent&mode=now']);
    // StartNowPanel renders the workflow_type as a SectionLabel and the Start Workflow button
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();
  });

  it('shows the SchedulePanel when a workflow is selected with mode=schedule', () => {
    renderPage(['/workflows/start?type=reviewContent&mode=schedule']);
    // SchedulePanel renders "Schedule" section label and "Save" button
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Common Patterns')).toBeInTheDocument();
  });

  it('switches between Start Now and Schedule modes', () => {
    renderPage(['/workflows/start?type=reviewContent&mode=now']);
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();

    // Click Schedule
    fireEvent.click(screen.getByText('Schedule'));
    expect(screen.getByText('Save')).toBeInTheDocument();

    // Click Start Now
    fireEvent.click(screen.getByText('Start Now'));
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();
  });

  it('displays workflow description when available', () => {
    renderPage();
    expect(screen.getByText('Review user-generated content')).toBeInTheDocument();
    expect(screen.getByText('Process insurance claims')).toBeInTheDocument();
  });

  it('shows execute_as bot badge in workflow selector', () => {
    renderPage();
    expect(screen.getByText('lt-system')).toBeInTheDocument();
  });

  it('shows roles in StartNowPanel', () => {
    renderPage(['/workflows/start?type=reviewContent&mode=now']);
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('shows identity summary in StartNowPanel', () => {
    renderPage(['/workflows/start?type=reviewContent&mode=now']);
    expect(screen.getByText('Running as')).toBeInTheDocument();
    // No execute_as, so shows user
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('auto-selects workflow when only one is available', () => {
    workflowConfigsOverride = {
      data: [mockConfigs[0]],
      isLoading: false,
    };
    discoveredOverride = { data: [], isLoading: false };
    renderPage();
    // With a single invocable workflow, it should auto-select it
    // and show the StartNowPanel instead of "Select a workflow"
    expect(screen.queryByText('Select a workflow to begin')).not.toBeInTheDocument();
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();
  });
});
