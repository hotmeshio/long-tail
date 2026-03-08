import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

vi.mock('../../../api/escalations', () => ({
  useEscalationStats: vi.fn(),
}));

vi.mock('../../../hooks/useNatsEvents', () => ({
  useEscalationStatsEvents: vi.fn(),
}));

import { EscalationsOverview } from '../EscalationsOverview';
import { useEscalationStats } from '../../../api/escalations';

const mockStats = {
  pending: 12,
  claimed: 3,
  created_1h: 5,
  created_24h: 42,
  resolved_1h: 2,
  resolved_24h: 18,
  by_role: [
    { role: 'reviewer', pending: 8, claimed: 2 },
    { role: 'engineer', pending: 4, claimed: 1 },
  ],
};

function renderWithRouter(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EscalationsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header with inline stats', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: mockStats,
    } as any);

    renderWithRouter(<EscalationsOverview />);

    expect(screen.getByText('Escalations')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getAllByText('Claimed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Created 24h')).toBeInTheDocument();
    expect(screen.getByText('Resolved 24h')).toBeInTheDocument();

    // Stat values
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('renders dash placeholders when data is loading', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: undefined,
    } as any);

    renderWithRouter(<EscalationsOverview />);

    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(4);
  });

  it('renders by-role breakdown table', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: mockStats,
    } as any);

    renderWithRouter(<EscalationsOverview />);

    expect(screen.getByText('By Role')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('engineer')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('hides by-role table when no roles', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: { ...mockStats, by_role: [] },
    } as any);

    renderWithRouter(<EscalationsOverview />);

    expect(screen.queryByText('By Role')).not.toBeInTheDocument();
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  });

  it('shows zero counts in tertiary style', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: {
        ...mockStats,
        by_role: [{ role: 'reviewer', pending: 5, claimed: 0 }],
      },
    } as any);

    const { container } = renderWithRouter(<EscalationsOverview />);

    const zeroCells = container.querySelectorAll('.text-text-tertiary');
    const zeroTexts = Array.from(zeroCells).map(el => el.textContent);
    expect(zeroTexts).toContain('0');
  });

  it('renders dot indicators on inline stats', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: mockStats,
    } as any);

    const { container } = renderWithRouter(<EscalationsOverview />);

    expect(container.querySelector('.bg-status-pending')).toBeInTheDocument();
    expect(container.querySelector('.bg-status-active')).toBeInTheDocument();
    expect(container.querySelector('.bg-status-success')).toBeInTheDocument();
  });
});
