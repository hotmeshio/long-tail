import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../api/tasks', () => ({
  useProcessStats: vi.fn(),
}));

vi.mock('../../../hooks/useEventHooks', () => ({
  useProcessListEvents: vi.fn(),
}));

import { ProcessesOverview } from '../ProcessesOverview';
import { useProcessStats } from '../../../api/tasks';

const mockStats = {
  total: 25,
  active: 10,
  completed: 12,
  escalated: 3,
  by_workflow_type: [
    { workflow_type: 'reviewContent', total: 15, active: 6, completed: 8, escalated: 1 },
    { workflow_type: 'kitchenSink', total: 10, active: 4, completed: 4, escalated: 2 },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProcessesOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProcessesOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProcessStats).mockReturnValue({ data: mockStats } as any);
  });

  // ── Header & Duration tabs ──

  it('renders header and duration tabs', () => {
    renderPage();
    expect(screen.getByText('Processes')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
  });

  it('defaults to 24h period', () => {
    renderPage();
    expect(useProcessStats).toHaveBeenCalledWith('24h');
  });

  it('switches period on tab click', () => {
    renderPage();
    fireEvent.click(screen.getByText('7d'));
    expect(useProcessStats).toHaveBeenCalledWith('7d');
  });

  // ── Summary cards ──

  it('renders summary cards with values', () => {
    renderPage();
    expect(screen.getAllByText('Total').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Escalated').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
  });

  it('renders dash placeholders when loading', () => {
    vi.mocked(useProcessStats).mockReturnValue({ data: undefined } as any);
    renderPage();
    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(4);
  });

  // ── By-workflow-type table ──

  it('renders by-workflow-type breakdown', () => {
    renderPage();
    expect(screen.getByText('Workflow Type')).toBeInTheDocument();
    expect(screen.getByText('reviewContent')).toBeInTheDocument();
    expect(screen.getByText('kitchenSink')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('hides table when no workflow types', () => {
    vi.mocked(useProcessStats).mockReturnValue({
      data: { ...mockStats, by_workflow_type: [] },
    } as any);
    renderPage();
    expect(screen.queryByText('reviewContent')).not.toBeInTheDocument();
  });

  // ── Zero counts ──

  it('renders zero counts in tertiary style', () => {
    vi.mocked(useProcessStats).mockReturnValue({
      data: {
        ...mockStats,
        by_workflow_type: [
          { workflow_type: 'test', total: 5, active: 5, completed: 0, escalated: 0 },
        ],
      },
    } as any);
    const { container } = renderPage();
    const zeroCells = container.querySelectorAll('.text-text-tertiary');
    const zeroTexts = Array.from(zeroCells).map((el) => el.textContent);
    expect(zeroTexts).toContain('0');
  });

  // ── Empty state ──

  it('shows empty state when no activity', () => {
    vi.mocked(useProcessStats).mockReturnValue({
      data: { total: 0, active: 0, completed: 0, escalated: 0, by_workflow_type: [] },
    } as any);
    renderPage();
    expect(screen.getByText(/No process activity/)).toBeInTheDocument();
  });
});
