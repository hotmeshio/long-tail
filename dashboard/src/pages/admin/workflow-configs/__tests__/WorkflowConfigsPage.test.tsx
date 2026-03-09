import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: vi.fn(),
  useDeleteWorkflowConfig: vi.fn(() => ({ mutate: vi.fn(), isPending: false, error: null })),
}));

import { WorkflowConfigsPage } from '../WorkflowConfigsPage';
import { useWorkflowConfigs } from '../../../../api/workflows';
import type { LTWorkflowConfig } from '../../../../api/types';

function makeConfig(overrides: Partial<LTWorkflowConfig> = {}): LTWorkflowConfig {
  return {
    workflow_type: 'review-content',
    description: null,
    is_lt: true,
    is_container: false,
    invocable: true,
    task_queue: 'default',
    default_role: 'reviewer',
    default_modality: 'portal',
    roles: ['reviewer'],
    invocation_roles: [],
    lifecycle: {},
    consumes: [],
    envelope_schema: null,
    resolver_schema: null,
    cron_schedule: null,
    ...overrides,
  };
}

const CONFIGS: LTWorkflowConfig[] = [
  makeConfig({
    workflow_type: 'review-content',
    description: 'Content review workflow',
    is_lt: true,
    is_container: false,
    invocable: true,
    task_queue: 'default',
    roles: ['reviewer', 'admin'],
  }),
  makeConfig({
    workflow_type: 'process-claim-orchestrator',
    description: 'Insurance claim orchestrator',
    is_lt: false,
    is_container: true,
    invocable: true,
    task_queue: 'claims',
    roles: ['claims-adjuster'],
  }),
  makeConfig({
    workflow_type: 'verify-document',
    is_lt: true,
    is_container: false,
    invocable: false,
    task_queue: 'default',
    roles: ['reviewer'],
    cron_schedule: '*/5 * * * *',
  }),
];

function renderPage(initialPath = '/workflows/config') {
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
    vi.mocked(useWorkflowConfigs).mockReturnValue({
      data: CONFIGS,
      isLoading: false,
    } as any);
  });

  // ── Rendering ──

  it('renders page header and Add Config button', () => {
    renderPage();
    expect(screen.getByText('Workflow Configurations')).toBeInTheDocument();
    expect(screen.getByText('Add Config')).toBeInTheDocument();
  });

  it('renders all configs when no filters applied', () => {
    renderPage();
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.getByText('verify-document')).toBeInTheDocument();
  });

  it('renders filter bar with search, queue, kind, and role controls', () => {
    renderPage();
    expect(screen.getByPlaceholderText('Search workflow type...')).toBeInTheDocument();
    expect(screen.getByText('Queue')).toBeInTheDocument();
    expect(screen.getByText('Kind')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
  });

  it('renders loading skeleton when loading', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders empty state when no configs', () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({
      data: [],
      isLoading: false,
    } as any);
    renderPage();
    expect(screen.getByText('No workflow configurations found')).toBeInTheDocument();
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

  // ── Filter: Kind ──

  it('filters by kind=container', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    // Kind is the second select
    fireEvent.change(selects[1], { target: { value: 'container' } });
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  it('filters by kind=invocable', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'invocable' } });
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('process-claim-orchestrator')).toBeInTheDocument();
    expect(screen.queryByText('verify-document')).not.toBeInTheDocument();
  });

  it('filters by kind=cron', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'cron' } });
    expect(screen.getByText('verify-document')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  it('filters by kind=lt (leaf only, not container)', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'lt' } });
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('verify-document')).toBeInTheDocument();
    expect(screen.queryByText('process-claim-orchestrator')).not.toBeInTheDocument();
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

  it('combines queue + kind filters', () => {
    renderPage();
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'default' } });
    fireEvent.change(selects[1], { target: { value: 'invocable' } });
    // Only review-content is in default queue AND invocable
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.queryByText('verify-document')).not.toBeInTheDocument();
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

  it('renders cron schedule badge', () => {
    renderPage();
    expect(screen.getByText('*/5 * * * *')).toBeInTheDocument();
  });

  it('renders role pills', () => {
    renderPage();
    // reviewer appears in multiple configs + filter dropdown
    expect(screen.getAllByText('reviewer').length).toBeGreaterThanOrEqual(1);
    // claims-adjuster appears in both the table pill and the filter dropdown
    expect(screen.getAllByText('claims-adjuster').length).toBeGreaterThanOrEqual(1);
  });

  // ── Delete ──

  it('shows delete icon on row hover', () => {
    renderPage();
    const deleteButtons = screen.getAllByTitle('Delete config');
    expect(deleteButtons.length).toBe(3);
  });
});

// ── matchesSearch / matchesKind unit tests (tested via rendering) ──

describe('filter helpers (via rendering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('search is case-insensitive', async () => {
    vi.mocked(useWorkflowConfigs).mockReturnValue({
      data: CONFIGS,
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
    vi.mocked(useWorkflowConfigs).mockReturnValue({
      data: CONFIGS,
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
