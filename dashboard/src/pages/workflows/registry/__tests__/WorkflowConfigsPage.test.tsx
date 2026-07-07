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
    tier: 'certified',
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
    workflow_type: 'kitchen-sink',
    description: 'Kitchen sink demo workflow',
    registered: true,
    invocable: true,
    task_queue: 'examples',
    roles: ['reviewer'],
  }),
  makeWorkflow({
    workflow_type: 'basic-echo',
    tier: 'registered',
    registered: true,
    invocable: true,
    task_queue: 'default',
    roles: [],
  }),
  makeWorkflow({
    workflow_type: 'unregistered-flow',
    description: 'Discovered but not registered',
    tier: 'durable',
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
    expect(screen.getByText('Registered Workflows')).toBeInTheDocument();
    expect(screen.getByText('Register Workflow')).toBeInTheDocument();
  });

  it('renders all workflows when no filters applied', () => {
    renderPage();
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('kitchen-sink')).toBeInTheDocument();
    expect(screen.getByText('basic-echo')).toBeInTheDocument();
    expect(screen.getByText('unregistered-flow')).toBeInTheDocument();
  });

  it('renders filter bar with search and queue tab controls', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Search \d+ workflows/)).toBeInTheDocument();
    // "All" tab is always shown in the queue filter bar
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    // Queue-specific tabs derived from data
    expect(screen.getByRole('button', { name: 'default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'examples' })).toBeInTheDocument();
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
    expect(screen.getByText('No workflows discovered yet.')).toBeInTheDocument();
  });

  // ── Tier column ──

  it('renders tier badges for certified, configured, and durable workflows', () => {
    renderPage();
    // review-content + kitchen-sink are certified
    expect(screen.getAllByText('Certified').length).toBe(2);
    // basic-echo is configured
    expect(screen.getAllByText('Registered').length).toBe(1);
    // unregistered-flow is durable
    expect(screen.getAllByText('Durable').length).toBe(1);
  });

  // ── Filter: Queue ──

  it('filters by queue', () => {
    renderPage();
    // Click the 'examples' queue tab button
    fireEvent.click(screen.getByRole('button', { name: 'examples' }));
    expect(screen.getByText('kitchen-sink')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
    expect(screen.queryByText('basic-echo')).not.toBeInTheDocument();
  });

  // ── Queue section grouping ──

  it('groups workflows under their queue section header', () => {
    renderPage();
    // Each queue renders as an h2 section header AND a filter tab — at least one of each
    expect(screen.getByRole('heading', { name: 'default' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'examples' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'user-queue' })).toBeInTheDocument();
  });

  it('shows all queue tabs in the filter bar', () => {
    renderPage();
    // All queues derived from data appear as tab buttons
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'examples' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'user-queue' })).toBeInTheDocument();
  });

  // ── Filter: access column ──

  it('renders access column with escalation and invocation role indicators', () => {
    renderPage();
    // review-content + kitchen-sink have escalation roles
    expect(screen.getAllByTitle('Escalation roles').length).toBe(2);
  });

  // ── Filter: Search ──

  it('filters by search text (workflow_type)', () => {
    renderPage();
    const input = screen.getByPlaceholderText(/Search \d+ workflows/);
    fireEvent.change(input, { target: { value: 'kitchen' } });
    expect(screen.getByText('kitchen-sink')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  it('filters by search text (description)', () => {
    renderPage();
    const input = screen.getByPlaceholderText(/Search \d+ workflows/);
    fireEvent.change(input, { target: { value: 'demo' } });
    expect(screen.getByText('kitchen-sink')).toBeInTheDocument();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  // ── Combined filters ──

  it('combines queue tab + search filters', () => {
    renderPage();
    // Activate the 'default' queue tab
    fireEvent.click(screen.getByRole('button', { name: 'default' }));
    // Then narrow by search
    const input = screen.getByPlaceholderText(/Search \d+ workflows/);
    fireEvent.change(input, { target: { value: 'review' } });
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.queryByText('basic-echo')).not.toBeInTheDocument();
    expect(screen.queryByText('kitchen-sink')).not.toBeInTheDocument();
  });

  // ── Facet options ──

  it('derives queue tabs from data', () => {
    renderPage();
    // All button always present
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    // One tab per unique task_queue value
    expect(screen.getByRole('button', { name: 'default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'examples' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'user-queue' })).toBeInTheDocument();
  });

  it('derives role pills from workflow access data', () => {
    renderPage();
    // reviewer appears across multiple workflows
    expect(screen.getAllByText('reviewer').length).toBeGreaterThanOrEqual(1);
    // admin appears for review-content escalation roles
    expect(screen.getAllByText('admin').length).toBeGreaterThanOrEqual(1);
  });

  // ── Column rendering ──

  it('renders role pills for registered workflows', () => {
    renderPage();
    // reviewer appears in multiple configs + filter dropdown
    expect(screen.getAllByText('reviewer').length).toBeGreaterThanOrEqual(1);
    // admin appears in both the table pill and the filter dropdown
    expect(screen.getAllByText('admin').length).toBeGreaterThanOrEqual(1);
  });

  // ── Actions ──

  it('shows remove config icon for registered workflows', () => {
    renderPage();
    const removeButtons = screen.getAllByTitle('Unregister workflow');
    // 2 certified + 1 registered = 3 with a registration row
    expect(removeButtons.length).toBe(3);
  });

  it('shows configure icon for durable workflows', () => {
    renderPage();
    const configureButtons = screen.getAllByTitle('Configure workflow');
    expect(configureButtons.length).toBe(1);
  });

  it('shows certify icon for configured workflows', () => {
    renderPage();
    const certifyButtons = screen.getAllByTitle('Certify workflow');
    expect(certifyButtons.length).toBe(1);
  });

  it('shows invoke action for invocable workflows', () => {
    renderPage();
    const invokeButtons = screen.getAllByTitle('Invoke workflow');
    // review-content + kitchen-sink + basic-echo are invocable
    expect(invokeButtons.length).toBe(3);
  });

  it('renders docs link in page header', () => {
    renderPage();
    expect(screen.getByTitle('Open docs for this page')).toBeInTheDocument();
  });

  it('renders escalation role icons for workflows with escalation roles', () => {
    renderPage();
    const escIcons = screen.getAllByTitle('Escalation roles');
    // review-content + kitchen-sink have escalation roles
    expect(escIcons.length).toBe(2);
  });

  it('renders invocation role icon when invocation_roles are set', () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: [makeWorkflow({ invocation_roles: ['engineer', 'superadmin'] })],
      isLoading: false,
    } as any);
    renderPage();
    expect(screen.getByTitle('Invocation roles')).toBeInTheDocument();
  });
});

// ── matchesSearch unit tests (tested via rendering) ──

describe('filter helpers (via rendering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('search is case-insensitive', () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: WORKFLOWS,
      isLoading: false,
    } as any);
    renderPage();
    const input = screen.getByPlaceholderText(/Search \d+ workflows/);
    fireEvent.change(input, { target: { value: 'REVIEW' } });
    expect(screen.getByText('review-content')).toBeInTheDocument();
  });

  it('clearing queue filter restores all results', () => {
    vi.mocked(useDiscoveredWorkflows).mockReturnValue({
      data: WORKFLOWS,
      isLoading: false,
    } as any);
    renderPage();
    // Filter to examples queue
    fireEvent.click(screen.getByRole('button', { name: 'examples' }));
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
    // Click 'All' to restore all results
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('kitchen-sink')).toBeInTheDocument();
  });
});
