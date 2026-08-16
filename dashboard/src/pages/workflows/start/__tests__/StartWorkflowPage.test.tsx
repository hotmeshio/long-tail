import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Shell panel mock — selection opens the run panel in the shell's right slot.
const mockSetPanel = vi.fn();
const mockClosePanel = vi.fn();
vi.mock('../../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({
    open: false,
    ownerKey: null,
    setPanel: mockSetPanel,
    closePanel: mockClosePanel,
  }),
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

// ── Tests — the full-width master list ───────────────────────────────────────

describe('StartWorkflowPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowConfigsOverride = undefined;
    discoveredOverride = undefined;
  });

  it('renders page header', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Invoke' })).toBeInTheDocument();
  });

  it('has no schedule toggle (cron is owned by agents/automations)', () => {
    renderPage();
    expect(screen.queryByText('Start Now')).not.toBeInTheDocument();
    expect(screen.queryByText('Schedule')).not.toBeInTheDocument();
  });

  it('renders workflow selector full-width with all invocable workflows', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { name: 'long-tail-examples-reviewContent' })).toBeInTheDocument();
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    expect(screen.getByText('processClaim')).toBeInTheDocument();
    expect(screen.getAllByText('durable').length).toBeGreaterThanOrEqual(1);
    // The old reserved right column is gone — the list is the page.
    expect(container.querySelector('.grid-cols-3')).not.toBeInTheDocument();
  });

  it('includes discovered durable workflows in the selector', () => {
    renderPage();
    expect(screen.getByText('durableOnly')).toBeInTheDocument();
  });

  it('opens no run panel when nothing is selected', () => {
    renderPage();
    expect(mockSetPanel).not.toHaveBeenCalled();
    expect(screen.queryByText('Select a workflow')).not.toBeInTheDocument();
  });

  it('shows a trailing invoke icon per row, quiet until row hover', () => {
    renderPage();
    const icons = screen.getAllByTitle('Configure & invoke');
    expect(icons.length).toBe(3); // reviewContent, processClaim, durableOnly
    for (const wrapper of icons) {
      const svg = wrapper.querySelector('svg');
      expect(svg?.getAttribute('class')).toContain('opacity-0');
      expect(svg?.getAttribute('class')).toContain('group-hover:opacity-100');
    }
  });

  it('keeps the trailing icon visible on the selected row', () => {
    renderPage(['/workflows/start?type=reviewContent']);
    const icons = screen.getAllByTitle('Configure & invoke');
    // Exact token match — the quiet rows carry group-hover:opacity-100 instead.
    const visible = icons.filter((w) =>
      w.querySelector('svg')?.getAttribute('class')?.split(' ').includes('opacity-100'),
    );
    expect(visible.length).toBe(1);
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

  it('displays workflow description when available', () => {
    renderPage();
    expect(screen.getByText('Review user-generated content')).toBeInTheDocument();
    expect(screen.getByText('Process insurance claims')).toBeInTheDocument();
  });

  it('shows execute_as bot badge in workflow selector', () => {
    renderPage();
    expect(screen.getByText('lt-system')).toBeInTheDocument();
  });

  it('auto-selects workflow when only one is available and opens its panel', () => {
    workflowConfigsOverride = { data: [mockConfigs[0]], isLoading: false };
    discoveredOverride = { data: [], isLoading: false };
    renderPage();
    expect(mockSetPanel).toHaveBeenCalled();
    expect(mockSetPanel.mock.calls[0][1]).toEqual({ key: 'invoke-run', width: 630 });
  });
});
