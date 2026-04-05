import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../api/workflows', () => ({
  useDiscoveredWorkflows: vi.fn(),
  useDeleteWorkflowConfig: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

import { WorkflowConfigsPage } from '../WorkflowConfigsPage';
import { useDiscoveredWorkflows } from '../../../../api/workflows';
import type { DiscoveredWorkflow } from '../../../../api/types';

function makeWorkflow(overrides: Partial<DiscoveredWorkflow> = {}): DiscoveredWorkflow {
  return {
    workflow_type: 'review-content',
    description: null,
    task_queue: 'default',
    registered: true,
    invocable: true,
    system: false,
    roles: ['reviewer'],
    invocation_roles: [],
    execute_as: null,
    ...overrides,
  };
}

const WORKFLOWS: DiscoveredWorkflow[] = [
  makeWorkflow({
    workflow_type: 'review-content',
    description: 'Content review workflow',
    registered: true,
    invocable: true,
    task_queue: 'default',
    roles: ['reviewer', 'admin'],
  }),
  makeWorkflow({
    workflow_type: 'process-claim-orchestrator',
    description: 'Insurance claim orchestrator',
    registered: true,
    invocable: true,
    task_queue: 'claims',
    roles: ['claims-adjuster'],
  }),
  makeWorkflow({
    workflow_type: 'verify-document',
    registered: true,
    invocable: false,
    task_queue: 'default',
    roles: ['reviewer'],
  }),
  makeWorkflow({
    workflow_type: 'unregistered-flow',
    description: 'Discovered but not registered',
    registered: false,
    invocable: false,
    task_queue: 'user-queue',
    roles: [],
  }),
];

function renderPage(initialPath = '/workflows/registry') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <WorkflowConfigsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkflowConfigsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: WORKFLOWS,
      isLoading: false,
    } as any);
  });

  // ── Rendering ──

  it('renders page header and Register Workflow button', () => {
    renderPage();
    expect(screen.getByText('Workflow Registry')).toBeInTheDocument();
    expect(screen.getByText('Register Workflow')).toBeInTheDocument();
  });

  it('renders all workflows when no filters applied', () => {
    renderPage();
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.getByText('verify-document')).toBeInTheDocument();
    expect(screen.getByText('unregistered-flow')).toBeInTheDocument();
  });

  it('renders filter bar with search, queue, tier, and role controls', () => {
    renderPage();
    expect(screen.getByPlaceholderText('Search workflow type...')).toBeInTheDocument();
    expect(screen.getAllByText('Queue').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Tier').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Role').length).toBeGreaterThanOrEqual(1);
  });

  it('renders loading skeleton when loading', () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state when no workflows', () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
    renderPage();
    expect(screen.getByText('No workflows found')).toBeInTheDocument();
  });

  // ── Tier column ──

  it('renders tier pills for certified and durable workflows', () => {
    renderPage();
    // 3 in table + 1 in filter dropdown option
    expect(screen.getAllByText('Certified').length).toBe(4);
    // 1 in table + 1 in filter dropdown option
    expect(screen.getAllByText('Durable').length).toBe(2);
  });

  // ── Filter: Queue ──

  it('filters by queue', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    // Queue is the first select
    fireEvent.change(selects[0], { target: { value: 'claims' } });
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
    expect(screen.queryByText('verify-document')).not.toBeInTheDocument();
  });

  // ── Filter: Tier ──

  it('filters by tier (certified)', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    // Tier is the second select (Queue, Tier, Role)
    fireEvent.change(selects[1], { target: { value: 'certified' } });
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.queryByText('unregistered-flow')).not.toBeInTheDocument();
  });

  it('filters by tier (durable)', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'durable' } });
    expect(screen.getByText('unregistered-flow')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  // ── Filter: Role ──

  it('filters by role', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    // Role is the third select
    fireEvent.change(selects[2], { target: { value: 'claims-adjuster' } });
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  // ── Filter: Search ──

  it('filters by search text (workflow_type)', async () => {
    vi.useFakeTimers();
    renderPage();
    const input = screen.getByPlaceholderText('Search workflow type...');
    fireEvent.change(input, { target: { value: 'claim' } });
    // Debounce fires after 300ms
    await act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('filters by search text (description)', async () => {
    vi.useFakeTimers();
    renderPage();
    const input = screen.getByPlaceholderText('Search workflow type...');
    fireEvent.change(input, { target: { value: 'insurance' } });
    await act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  // ── Combined filters ──

  it('combines queue + role filters', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'default' } });
    fireEvent.change(selects[2], { target: { value: 'reviewer' } });
    // review-content and verify-document are in default queue with reviewer role
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('verify-document')).toBeInTheDocument();
    expect(screen.queryByText('process-claim-orchestrator')).not.toBeInTheDocument();
  });

  // ── Facet options ──

  it('derives queue options from data', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    const queueSelect = selects[0];
    const options = Array.from(queueSelect.querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toContain('All');
    expect(options).toContain('default');
    expect(options).toContain('claims');
  });

  it('derives role options from data', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    const roleSelect = selects[2];
    const options = Array.from(roleSelect.querySelectorAll('option')).map(
      (o) => o.textContent,
    );
    expect(options).toContain('All');
    expect(options).toContain('reviewer');
    expect(options).toContain('admin');
    expect(options).toContain('claims-adjuster');
  });

  // ── Column rendering ──

  it('renders role pills for registered workflows', () => {
    renderPage();
    // reviewer appears in multiple configs + filter dropdown
    expect(screen.getAllByText('reviewer').length).toBeGreaterThanOrEqual(1);
    // claims-adjuster appears in both the table pill and the filter dropdown
    expect(screen.getAllByText('claims-adjuster').length).toBeGreaterThanOrEqual(1);
  });

  // ── Actions ──

  it('shows de-certify icon for certified workflows', () => {
    renderPage();
    const decertifyButtons = screen.getAllByTitle('De-certify workflow');
    expect(decertifyButtons.length).toBe(3);
  });

  it('shows certify icon for uncertified workflows', () => {
    renderPage();
    const certifyButtons = screen.getAllByTitle('Certify workflow');
    expect(certifyButtons.length).toBe(1);
  });
});

// ── matchesSearch unit tests (tested via rendering) ──

describe('filter helpers (via rendering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('search is case-insensitive', async () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: WORKFLOWS,
      isLoading: false,
    } as any);
    vi.useFakeTimers();
    renderPage();
    const input = screen.getByPlaceholderText('Search workflow type...');
    fireEvent.change(input, { target: { value: 'REVIEW' } });
    await act(() => vi.advanceTimersByTime(300));
    expect(screen.getByText('review-content')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('clearing filter restores all results', () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: WORKFLOWS,
      isLoading: false,
    } as any);
    renderPage();
    const selects = screen.getAllByRole('combobox');
    // Filter to claims queue
    fireEvent.change(selects[0], { target: { value: 'claims' } });
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
    // Clear filter
    fireEvent.change(selects[0], { target: { value: '' } });
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
  });
});
