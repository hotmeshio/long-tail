import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

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
    execute_as: null,
  },
];

vi.mock('../../../../api/workflows', () => ({
  useWorkflowConfigs: () => ({ data: mockConfigs, isLoading: false }),
  useDiscoveredWorkflows: () => ({ data: [], isLoading: false }),
  useCronStatus: () => ({ data: [] }),
  useInvokeWorkflow: () => ({ mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() }),
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

// Shell panel mock — a mutable state so tests can simulate open/close.
const mockSetPanel = vi.fn();
const mockClosePanel = vi.fn();
let shellState: { open: boolean; ownerKey: string | null } = { open: false, ownerKey: null };
vi.mock('../../../../hooks/useShellPanel', () => ({
  useShellPanelOptional: () => ({ ...shellState, setPanel: mockSetPanel, closePanel: mockClosePanel }),
}));

import { StartWorkflowPage } from '../StartWorkflowPage';

// ── Helpers ──────────────────────────────────────────────────────────────────

function page(initialEntries: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <StartWorkflowPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Render the node the page slid into the shell panel, with providers. */
function renderPanelNode(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastInvokePanelCall() {
  const calls = mockSetPanel.mock.calls.filter(([, opts]) => opts?.key === 'invoke-run');
  return calls[calls.length - 1];
}

// ── Tests — ?type= ↔ shell panel sync ────────────────────────────────────────

describe('StartWorkflowPage ?type= ↔ run panel sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shellState = { open: false, ownerKey: null };
  });

  it('opens the run panel in the shell for a ?type= deep link', () => {
    render(page(['/workflows/durable/invoke?type=reviewContent']));
    const call = lastInvokePanelCall();
    expect(call).toBeDefined();
    expect(call[1]).toEqual({ key: 'invoke-run', width: 630 });
    renderPanelNode(call[0]);
    expect(screen.getByText('Start Workflow')).toBeInTheDocument();
  });

  it('opens the run panel when a workflow row is clicked', () => {
    render(page(['/workflows/durable/invoke']));
    expect(mockSetPanel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('reviewContent'));
    const call = lastInvokePanelCall();
    expect(call).toBeDefined();
    renderPanelNode(call[0]);
    expect(screen.getByText('Running as')).toBeInTheDocument();
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  it('closing the panel via its X clears ?type= and releases the slot', () => {
    render(page(['/workflows/durable/invoke?type=reviewContent']));
    renderPanelNode(lastInvokePanelCall()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Clearing the param drives the sync effect to close the keyed slot.
    expect(mockClosePanel).toHaveBeenCalledWith('invoke-run');
  });

  it('clears the selection when the panel is closed externally', () => {
    const view = render(page(['/workflows/durable/invoke?type=reviewContent']));
    // The shell reports our panel open…
    shellState = { open: true, ownerKey: 'invoke-run' };
    view.rerender(page(['/workflows/durable/invoke?type=reviewContent']));
    expect(mockClosePanel).not.toHaveBeenCalledWith('invoke-run');
    // …then closed (its X, or another claimant took the slot): the selection
    // clears and the sync effect releases the keyed slot.
    shellState = { open: false, ownerKey: null };
    view.rerender(page(['/workflows/durable/invoke?type=reviewContent']));
    expect(mockClosePanel).toHaveBeenCalledWith('invoke-run');
  });

  it('releases the panel slot on unmount', () => {
    const { unmount } = render(page(['/workflows/durable/invoke?type=reviewContent']));
    unmount();
    expect(mockClosePanel).toHaveBeenCalledWith('invoke-run');
  });
});
