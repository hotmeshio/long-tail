import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseAggregateByFacets = vi.fn();
vi.mock('../../../api/escalation-analytics', () => ({
  useAggregateByFacets: (...args: unknown[]) => mockUseAggregateByFacets(...args),
}));

import { ViewMenu } from '../ViewMenu';

// One menu that scales to arbitrarily many systems — never one piece of
// chrome per system. The chip-per-lens strip this replaces grew without bound.

const LENSES = ['batchId', 'orderId', 'serialNumber', 'toolId'];
const onSelect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAggregateByFacets.mockReturnValue({
    data: { groups: [{ count: 42, sampleCount: 42, facets: {} }], overflow: false },
  });
});

describe('ViewMenu', () => {
  it('collapsed, shows only the active view — no per-lens chrome', () => {
    render(<ViewMenu lenses={LENSES} activeLens="serialNumber" stationCount={8} onSelect={onSelect} />);
    expect(screen.getByText('serialNumber')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText('by orderId')).not.toBeInTheDocument();
  });

  it('open, lists Stations plus every declared lens as rows', () => {
    render(<ViewMenu lenses={LENSES} activeLens={null} stationCount={8} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('Board view'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1 + LENSES.length);
    expect(options[0]).toHaveTextContent('Stations');
    expect(options[0]).toHaveTextContent('8 stations');
    expect(options[3]).toHaveTextContent('by serialNumber');
  });

  it('selecting a lens (or Stations) reports and closes', () => {
    render(<ViewMenu lenses={LENSES} activeLens={null} stationCount={8} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText('Board view'));
    fireEvent.click(screen.getByText('by orderId'));
    expect(onSelect).toHaveBeenCalledWith('orderId');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('lens counts load only while the menu is open, and render per row', () => {
    render(<ViewMenu lenses={LENSES} activeLens={null} stationCount={8} onSelect={onSelect} />);
    expect(mockUseAggregateByFacets).not.toHaveBeenCalled(); // closed = zero queries

    fireEvent.click(screen.getByLabelText('Board view'));
    const calls = mockUseAggregateByFacets.mock.calls;
    expect(calls).toHaveLength(LENSES.length);
    expect(calls[0][0]).toMatchObject({
      query: { entity: 'batchId' },
      measure: { kind: 'membership' },
      distinctBy: 'batchId',
    });
    expect(calls[0][1]).toEqual({ enabled: true });
    expect(screen.getAllByText('42 in queue')).toHaveLength(LENSES.length);
  });
});
