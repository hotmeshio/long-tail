import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../../api/escalations', () => ({
  useEscalationStats: vi.fn(),
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

describe('EscalationsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders stat cards with data', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: mockStats,
    } as any);

    render(<EscalationsOverview />);

    // PageHeader
    expect(screen.getByText('Escalations Dashboard')).toBeInTheDocument();

    // Stat card labels (Claimed also appears as a table header)
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getAllByText('Claimed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Created (24h)')).toBeInTheDocument();
    expect(screen.getByText('Resolved (24h)')).toBeInTheDocument();

    // Stat card values
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();

    // Sub text
    expect(screen.getByText('5 in last hour')).toBeInTheDocument();
    expect(screen.getByText('2 in last hour')).toBeInTheDocument();
  });

  it('renders dash placeholders when data is loading', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: undefined,
    } as any);

    render(<EscalationsOverview />);

    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(4);
  });

  it('renders by-role breakdown table', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: mockStats,
    } as any);

    render(<EscalationsOverview />);

    // Section label
    expect(screen.getByText('By Role')).toBeInTheDocument();

    // Table headers
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();

    // Role rows
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('engineer')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('hides by-role table when no roles', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: { ...mockStats, by_role: [] },
    } as any);

    render(<EscalationsOverview />);

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

    const { container } = render(<EscalationsOverview />);

    // The claimed "0" should use tertiary text color
    const zeroCells = container.querySelectorAll('.text-text-tertiary');
    const zeroTexts = Array.from(zeroCells).map(el => el.textContent);
    expect(zeroTexts).toContain('0');
  });

  it('renders dot indicators on stat cards', () => {
    vi.mocked(useEscalationStats).mockReturnValue({
      data: mockStats,
    } as any);

    const { container } = render(<EscalationsOverview />);

    // Pending dot
    expect(container.querySelector('.bg-status-pending')).toBeInTheDocument();
    // Active dot (claimed)
    expect(container.querySelector('.bg-status-active')).toBeInTheDocument();
    // Success dot (resolved)
    expect(container.querySelector('.bg-status-success')).toBeInTheDocument();
  });
});
