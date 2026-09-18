import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const query = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[], totals: {} as Record<string, number> }));
vi.mock('../../../hooks/useEscalationListQuery', () => ({
  useEscalationListQuery: (params: Record<string, unknown>, opts: Record<string, unknown>) => {
    query.calls.push({ ...params, ...opts });
    const total = query.totals[String(params.statusFilter)] ?? 0;
    return { escalations: [], total, isLoading: false, isFetching: false, error: null, refetch: vi.fn(), listSchema: null, singleRole: null, hasRichView: false };
  },
}));

import { PortalCounts } from '../PortalCounts';

beforeEach(() => { query.calls = []; query.totals = {}; });

describe('PortalCounts', () => {
  it('renders one tile per count with the compact total, label, blurb, and link, reading each total with limit 1', () => {
    query.totals = { available: 1284, claimed: 7 };
    render(
      <MemoryRouter>
        <PortalCounts
          counts={[
            { label: 'Waiting', url: '/escalations/available?role=reviewer', blurb: 'Unclaimed items' },
            { label: 'In progress', url: '/escalations/available?role=reviewer&status=claimed' },
          ]}
          resolveUrl={(u) => u}
        />
      </MemoryRouter>,
    );
    const tiles = screen.getAllByTestId('portal-count');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveAttribute('href', '/escalations/available?role=reviewer');
    expect(tiles[0]).toHaveTextContent('Waiting');
    expect(tiles[0]).toHaveTextContent('Unclaimed items');
    expect(screen.getAllByTestId('portal-count-value')[0]).toHaveTextContent('1,284');
    expect(screen.getAllByTestId('portal-count-value')[1]).toHaveTextContent('7');
    expect(query.calls.every((c) => c.limit === 1)).toBe(true);
  });

  it('renders nothing without counts and a dash for a URL that is not a list', () => {
    const { container } = render(<MemoryRouter><PortalCounts counts={[]} resolveUrl={(u) => u} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
    render(<MemoryRouter><PortalCounts counts={[{ label: 'Ops', url: '/operations' }]} resolveUrl={(u) => u} /></MemoryRouter>);
    expect(screen.getByTestId('portal-count-value')).toHaveTextContent('—');
    expect(query.calls[query.calls.length - 1].enabled).toBe(false);
  });
});
