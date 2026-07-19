import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { StationMetric } from '../../../api/escalations';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { TaskQueueCard, ClaimedCard } from '../TaskQueueCard';

function metric(over: Partial<StationMetric> = {}): StationMetric {
  return {
    role: 'printer',
    pending: 12,
    claimed: 3,
    resolved: 42,
    priority_count: 0,
    throughput_pct: null,
    wait: { p99: null, p50: null, avg: null, max: null },
    work: { p99: null, p50: null, avg: null, max: null },
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('TaskQueueCard', () => {
  it('shows the lane title and the three counts', () => {
    render(<TaskQueueCard role="printer" title="Print Farm" metric={metric()} priorityFacet={null} periodLabel="24h" />);
    expect(screen.getByText('Print Farm')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('resolved · 24h')).toBeInTheDocument();
  });

  it('falls back to the role name when there is no title', () => {
    render(<TaskQueueCard role="printer" title={null} metric={metric()} priorityFacet={null} periodLabel="1h" />);
    expect(screen.getByText('printer')).toBeInTheDocument();
  });

  it('renders zeros when no metric is available yet', () => {
    render(<TaskQueueCard role="printer" title="Print Farm" metric={undefined} priorityFacet={null} periodLabel="24h" />);
    expect(screen.getByText('on pace')).toBeInTheDocument();
  });

  it('shows "on pace" when nothing is in jeopardy', () => {
    render(<TaskQueueCard role="printer" title="Print Farm" metric={metric({ priority_count: 0 })} priorityFacet={null} periodLabel="24h" />);
    expect(screen.getByText('on pace')).toBeInTheDocument();
    expect(screen.queryByText(/in jeopardy/)).not.toBeInTheDocument();
  });

  it('shows the jeopardy pill when items are past threshold', () => {
    render(<TaskQueueCard role="printer" title="Print Farm" metric={metric({ priority_count: 5 })} priorityFacet={null} periodLabel="24h" />);
    expect(screen.getByText('5 in jeopardy')).toBeInTheDocument();
  });

  it('opens the lane queue when the card body is clicked', () => {
    render(<TaskQueueCard role="printer" title="Print Farm" metric={metric()} priorityFacet={null} periodLabel="24h" />);
    fireEvent.click(screen.getByText('Print Farm'));
    expect(navigate).toHaveBeenCalledWith('/escalations/available?role=printer');
  });

  it('jeopardy pill deep-links to the priority-sorted queue and stops propagation', () => {
    render(<TaskQueueCard role="printer" title="Print Farm" metric={metric({ priority_count: 5 })} priorityFacet="authorized_at" periodLabel="24h" />);
    fireEvent.click(screen.getByText('5 in jeopardy'));
    // Faceted orderBy on the configured priority facet, oldest first.
    const url = navigate.mock.calls[0][0] as string;
    expect(url).toContain('/escalations/available?role=printer');
    expect(url).toContain('orderBy=');
    expect(decodeURIComponent(url)).toContain('metadata.authorized_at');
    // The card-body navigate must NOT also fire.
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('ClaimedCard', () => {
  it('shows the cross-role claimed count and a call to action', () => {
    render(<ClaimedCard count={4} />);
    expect(screen.getByText('Claimed')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Finish these first →')).toBeInTheDocument();
  });

  it('reads calmly when nothing is claimed', () => {
    render(<ClaimedCard count={0} />);
    expect(screen.getByText('Nothing claimed')).toBeInTheDocument();
  });

  it('opens the personal queue on click', () => {
    render(<ClaimedCard count={4} />);
    fireEvent.click(screen.getByText('Claimed'));
    expect(navigate).toHaveBeenCalledWith('/escalations/queue');
  });
});
