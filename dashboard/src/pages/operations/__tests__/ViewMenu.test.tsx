import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseAggregateByFacets = vi.fn();
vi.mock('../../../api/escalation-analytics', () => ({
  useAggregateByFacets: (...args: unknown[]) => mockUseAggregateByFacets(...args),
}));

import { ViewMenu, type FragmentOption } from '../ViewMenu';

const FRAGMENTS: FragmentOption[] = [
  { origin: 'design', title: 'Design', roleCount: 8, pending: 0, jeopardy: 0 },
  { origin: 'ordering', title: 'Ordering', roleCount: 3, pending: 2, jeopardy: 1 },
];
const LENSES = ['orderId', 'serialNumber'];
const onSelectFragment = vi.fn();
const onSelectLens = vi.fn();

function renderMenu(over: Record<string, unknown> = {}) {
  return render(
    <ViewMenu
      fragments={FRAGMENTS}
      activeFragment="design"
      lenses={LENSES}
      activeLens={null}
      onSelectFragment={onSelectFragment}
      onSelectLens={onSelectLens}
      {...over}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAggregateByFacets.mockReturnValue({
    data: { groups: [{ count: 42, sampleCount: 42, facets: {} }], overflow: false },
  });
});

describe('ViewMenu', () => {
  it('collapsed on the Pace Board, names the active segment; no rows', () => {
    renderMenu();
    expect(screen.getByLabelText('Board view')).toHaveTextContent('Design');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('collapsed on a Trend, names the active facet', () => {
    renderMenu({ activeLens: 'serialNumber' });
    expect(screen.getByLabelText('Board view')).toHaveTextContent('serialNumber');
  });

  it('open, groups segments under Pace Board and lenses under Trend Board', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Board view'));
    expect(screen.getByText('Pace Board')).toBeInTheDocument();
    expect(screen.getByText('Trend Board')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(FRAGMENTS.length + LENSES.length);
    expect(options[0]).toHaveTextContent('Design');
    expect(options[0]).toHaveTextContent('8 roles');
    expect(options[FRAGMENTS.length]).toHaveTextContent('by orderId');
  });

  it('selecting a segment reports via onSelectFragment and closes', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Board view'));
    fireEvent.click(screen.getByText('Ordering'));
    expect(onSelectFragment).toHaveBeenCalledWith('ordering');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selecting a lens reports via onSelectLens and closes', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('Board view'));
    fireEvent.click(screen.getByText('by orderId'));
    expect(onSelectLens).toHaveBeenCalledWith('orderId');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('lens counts load only while the menu is open, one query per lens', () => {
    renderMenu();
    expect(mockUseAggregateByFacets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Board view'));
    const calls = mockUseAggregateByFacets.mock.calls;
    expect(calls).toHaveLength(LENSES.length);
    expect(calls[0][0]).toMatchObject({
      query: { entity: 'orderId' },
      measure: { kind: 'membership' },
      distinctBy: 'orderId',
    });
    expect(calls[0][1]).toEqual({ enabled: true });
    expect(screen.getAllByText('42 in queue')).toHaveLength(LENSES.length);
  });
});
