import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockMutate = vi.fn();
const mockUseMaintenanceConfig = vi.fn();

vi.mock('../../../../api/maintenance', () => ({
  usePrune: () => ({
    mutate: mockMutate,
    isPending: false,
    error: null,
  }),
  useMaintenanceConfig: (...args: unknown[]) => mockUseMaintenanceConfig(...args),
  useUpdateMaintenanceConfig: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

const DEFAULT_CONFIG = {
  data: {
    config: {
      schedule: '0 2 * * *',
      rules: [
        { target: 'streams', action: 'delete', olderThan: '1 day' },
        { target: 'jobs', action: 'delete', olderThan: '30 days', pruned: true },
      ],
    },
    active: true,
  },
  isLoading: false,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/maintenance']}>
        <MaintenancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { MaintenancePage } from '../MaintenancePage';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MaintenancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMaintenanceConfig.mockReturnValue(DEFAULT_CONFIG);
  });

  it('renders the page header', () => {
    renderPage();
    expect(screen.getByText('DB Maintenance')).toBeInTheDocument();
  });

  it('renders the mode toggle with both options', () => {
    renderPage();
    expect(screen.getAllByText('Prune Now').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Schedule').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the info callout', () => {
    renderPage();
    expect(screen.getByText(/Completed process data grows indefinitely/)).toBeInTheDocument();
  });

  it('defaults to Schedule mode and shows schedule section', () => {
    renderPage();
    // Schedule section has a cron expression input
    expect(screen.getByPlaceholderText('0 2 * * *')).toBeInTheDocument();
    // Active status shown
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('switches to Prune Now mode when clicked', () => {
    renderPage();
    fireEvent.click(screen.getByText('Prune Now'));
    // Prune section has a "Prune Now" action button (distinct from the toggle)
    const pruneButtons = screen.getAllByText('Prune Now');
    expect(pruneButtons.length).toBeGreaterThanOrEqual(2); // toggle + action button
  });

  it('renders Delete Expired Data fields in both modes', () => {
    renderPage();
    expect(screen.getByText('Delete Expired Data')).toBeInTheDocument();
    expect(screen.getByText('Jobs')).toBeInTheDocument();
    expect(screen.getByText('Engine streams')).toBeInTheDocument();
    expect(screen.getByText('Worker streams')).toBeInTheDocument();
  });

  it('renders Cleanup section in both modes', () => {
    renderPage();
    expect(screen.getByText('Cleanup')).toBeInTheDocument();
    expect(screen.getByText('Strip execution artifacts')).toBeInTheDocument();
    expect(screen.getByText('Delete transient jobs')).toBeInTheDocument();
  });

  it('renders cron preset pills in Schedule mode', () => {
    renderPage();
    expect(screen.getAllByText('Daily at 2 AM').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Weekly (Sun 2 AM)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Monthly (1st at 2 AM)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Every 6 hours').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the Save Schedule button in Schedule mode', () => {
    renderPage();
    expect(screen.getByText('Save Schedule')).toBeInTheDocument();
  });

  it('renders the How It Works callout in Schedule mode', () => {
    renderPage();
    expect(screen.getByText('How It Works')).toBeInTheDocument();
    expect(screen.getByText(/Rules execute sequentially/)).toBeInTheDocument();
  });
});

describe('MaintenancePage - Prune mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMaintenanceConfig.mockReturnValue(DEFAULT_CONFIG);
  });

  function renderPruneMode() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/admin/maintenance']}>
          <MaintenancePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText('Prune Now'));
  }

  it('shows the destructive warning text', () => {
    renderPruneMode();
    expect(screen.getByText(/permanently deletes data/)).toBeInTheDocument();
  });

  it('opens confirm modal when Prune Now button is clicked', () => {
    renderPruneMode();
    // Find the action button (not the toggle)
    const actionButtons = screen.getAllByText('Prune Now');
    const actionButton = actionButtons[actionButtons.length - 1];
    fireEvent.click(actionButton);
    expect(screen.getAllByText('Confirm Prune').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/This will permanently delete data/)).toBeInTheDocument();
  });

  it('shows cancel button in confirm modal', () => {
    renderPruneMode();
    const actionButtons = screen.getAllByText('Prune Now');
    fireEvent.click(actionButtons[actionButtons.length - 1]);
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('closes confirm modal on Cancel', () => {
    renderPruneMode();
    const actionButtons = screen.getAllByText('Prune Now');
    fireEvent.click(actionButtons[actionButtons.length - 1]);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Confirm Prune')).not.toBeInTheDocument();
  });
});

describe('MaintenancePage - Schedule loading state', () => {
  it('renders loading skeleton when config is loading', () => {
    mockUseMaintenanceConfig.mockReturnValue({ data: undefined, isLoading: true });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MaintenancePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
