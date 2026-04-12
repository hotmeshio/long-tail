import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockConfigs = [
  {
    workflow_type: 'dailyReport',
    description: 'Generates daily summary reports',
    invocable: true,
    task_queue: 'default',
    default_role: 'admin',
    roles: ['admin'],
    invocation_roles: ['admin'],
    consumes: [],
    envelope_schema: { data: { format: 'pdf' }, metadata: {} },
    resolver_schema: null,
    cron_schedule: '0 9 * * *',
    execute_as: null,
  },
  {
    workflow_type: 'weeklyCleanup',
    description: 'Cleans up stale data weekly',
    invocable: true,
    task_queue: 'default',
    default_role: 'admin',
    roles: ['admin'],
    invocation_roles: ['admin'],
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
  },
  {
    workflow_type: 'internalOnly',
    description: 'Not invocable',
    invocable: false,
    task_queue: 'default',
    default_role: 'admin',
    roles: [],
    invocation_roles: [],
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    execute_as: null,
  },
];

const mockCronEntries = [
  {
    workflow_type: 'dailyReport',
    cron_schedule: '0 9 * * *',
    description: 'Generates daily summary reports',
    task_queue: 'default',
    invocable: true,
    active: true,
    envelope_schema: null,
  },
];

const mockJobs = {
  jobs: [
    {
      workflow_id: 'job-abc-123',
      status: 'completed',
      created_at: '2026-04-10T09:00:00Z',
    },
    {
      workflow_id: 'job-def-456',
      status: 'running',
      created_at: '2026-04-11T09:00:00Z',
    },
  ],
  total: 2,
};

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockMutate = vi.fn();
const mockReset = vi.fn();

let workflowConfigsReturn: { data: typeof mockConfigs | undefined; isLoading: boolean };
let cronStatusReturn: { data: typeof mockCronEntries | undefined };

vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: () => workflowConfigsReturn,
  useCronStatus: () => cronStatusReturn,
  useSetCronSchedule: () => ({
    mutate: mockMutate,
    isPending: false,
    isSuccess: false,
    error: null,
    reset: mockReset,
  }),
  useJobs: () => ({ data: mockJobs, isLoading: false }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderPage(route = '/workflows/cron') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <CronWorkflowsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { CronWorkflowsPage } from '../CronWorkflowsPage';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CronWorkflowsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowConfigsReturn = { data: mockConfigs, isLoading: false };
    cronStatusReturn = { data: mockCronEntries };
  });

  // -- Positive: page renders with workflow list --

  it('renders page header', () => {
    renderPage();
    expect(screen.getByText('Cron')).toBeInTheDocument();
  });

  it('displays only invocable workflows in the selector', () => {
    renderPage();
    expect(screen.getByText('dailyReport')).toBeInTheDocument();
    expect(screen.getByText('weeklyCleanup')).toBeInTheDocument();
    // Non-invocable workflow should not appear
    expect(screen.queryByText('internalOnly')).not.toBeInTheDocument();
  });

  it('shows cron expression for workflows with a schedule', () => {
    renderPage();
    expect(screen.getByText('0 9 * * *')).toBeInTheDocument();
  });

  it('shows "No schedule" for workflows without a cron schedule', () => {
    renderPage();
    expect(screen.getByText('No schedule')).toBeInTheDocument();
  });

  it('shows description text for workflows', () => {
    renderPage();
    expect(screen.getByText('Generates daily summary reports')).toBeInTheDocument();
    expect(screen.getByText('Cleans up stale data weekly')).toBeInTheDocument();
  });

  // -- Positive: detail panel shows when selected --

  it('shows detail panel when a workflow is selected', () => {
    renderPage('/workflows/cron?type=dailyReport');
    // Detail panel header
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Cron Envelope')).toBeInTheDocument();
    expect(screen.getByText('Recent Executions')).toBeInTheDocument();
  });

  it('shows active pill for a workflow with active cron', () => {
    renderPage('/workflows/cron?type=dailyReport');
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows Save button in schedule editor', () => {
    renderPage('/workflows/cron?type=dailyReport');
    expect(screen.getByText('Save')).toBeInTheDocument();
  });

  it('shows Clear button when workflow has a cron schedule', () => {
    renderPage('/workflows/cron?type=dailyReport');
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('shows common patterns section', () => {
    renderPage('/workflows/cron?type=dailyReport');
    expect(screen.getByText('Common Patterns')).toBeInTheDocument();
    expect(screen.getByText('Every 15 min')).toBeInTheDocument();
    expect(screen.getByText('Every hour')).toBeInTheDocument();
  });

  it('renders recent executions table with job data', () => {
    renderPage('/workflows/cron?type=dailyReport');
    expect(screen.getByText('job-abc-123')).toBeInTheDocument();
    expect(screen.getByText('job-def-456')).toBeInTheDocument();
  });

  it('shows form/json toggle when envelope has scalar data fields', () => {
    renderPage('/workflows/cron?type=dailyReport');
    expect(screen.getByText('Form')).toBeInTheDocument();
    expect(screen.getByText('JSON')).toBeInTheDocument();
  });

  // -- Negative: no selection --

  it('shows placeholder when no workflow is selected', () => {
    renderPage();
    expect(
      screen.getByText('Select a workflow to configure its cron schedule'),
    ).toBeInTheDocument();
  });

  // -- Negative: empty list --

  it('shows empty message when no invocable workflows exist', () => {
    workflowConfigsReturn = { data: [], isLoading: false };
    renderPage();
    expect(screen.getByText('No invocable workflows')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Mark workflows as invocable in Workflow Configs to enable cron scheduling.',
      ),
    ).toBeInTheDocument();
  });

  // -- Loading state --

  it('shows loading skeleton while configs load', () => {
    workflowConfigsReturn = { data: undefined, isLoading: true };
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  // -- Interaction: selecting a workflow --

  it('selects a workflow when clicked', () => {
    renderPage();
    fireEvent.click(screen.getByText('weeklyCleanup'));
    // After clicking, detail panel should show for that workflow
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Cron Envelope')).toBeInTheDocument();
  });

  it('does not show Clear button when selected workflow has no cron', () => {
    renderPage('/workflows/cron?type=weeklyCleanup');
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });
});
