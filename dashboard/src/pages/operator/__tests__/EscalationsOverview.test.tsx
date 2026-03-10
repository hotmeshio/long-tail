import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

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
  created: 42,
  resolved: 18,
  by_role: [
    { role: 'reviewer', pending: 8, claimed: 2 },
    { role: 'engineer', pending: 4, claimed: 1 },
  ],
  by_type: [
    { type: 'review-content', pending: 6, claimed: 1, resolved: 10 },
    { type: 'verify-document', pending: 3, claimed: 2, resolved: 5 },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EscalationsOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EscalationsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useEscalationStats).mockReturnValue({ data: mockStats } as any);
  });

  // ── Header & Duration tabs ──

  it('renders header and duration tabs', () => {
    renderPage();
    expect(screen.getByText('Escalations')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
    expect(screen.getByText('24h')).toBeInTheDocument();
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
  });

  it('defaults to 24h period', () => {
    renderPage();
    expect(useEscalationStats).toHaveBeenCalledWith('24h');
  });

  it('switches period on tab click', () => {
    renderPage();
    fireEvent.click(screen.getByText('7d'));
    expect(useEscalationStats).toHaveBeenCalledWith('7d');
  });

  // ── Summary cards ──

  it('renders summary cards with values', () => {
    renderPage();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('Claimed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getAllByText('Resolved').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('renders dash placeholders when loading', () => {
    vi.mocked(useEscalationStats).mockReturnValue({ data: undefined } as any);
    renderPage();
    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(4);
  });

  // ── By-role table ──

  it('renders by-role breakdown', () => {
    renderPage();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('engineer')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('hides by-role table when no roles', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: { ...mockStats, by_role: [], by_type: [] },
    } as any);
    renderPage();
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  });

  // ── By-type table ──

  it('renders by-type breakdown', () => {
    renderPage();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('review-content')).toBeInTheDocument();
    expect(screen.getByText('verify-document')).toBeInTheDocument();
  });

  it('hides by-type table when empty', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: { ...mockStats, by_type: [] },
    } as any);
    renderPage();
    expect(screen.queryByText('review-content')).not.toBeInTheDocument();
  });

  // ── Zero counts ──

  it('renders zero counts in tertiary style', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: {
        ...mockStats,
        by_role: [{ role: 'reviewer', pending: 5, claimed: 0 }],
      },
    } as any);

    const { container } = renderPage();
    const zeroCells = container.querySelectorAll('.text-text-tertiary');
    const zeroTexts = Array.from(zeroCells).map((el) => el.textContent);
    expect(zeroTexts).toContain('0');
  });

  // ── Empty state ──

  it('shows empty state message when no activity', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: { pending: 0, claimed: 0, created: 0, resolved: 0, by_role: [], by_type: [] },
    } as any);
    renderPage();
    expect(screen.getByText(/No escalation activity/)).toBeInTheDocument();
  });
});
