import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const query = vi.hoisted(() => ({
  calls: [] as { params: Record<string, unknown>; opts: Record<string, unknown> }[],
  result: {} as Record<string, unknown>,
}));
vi.mock('../../../hooks/useEscalationListQuery', () => ({
  useEscalationListQuery: (params: Record<string, unknown>, opts: Record<string, unknown>) => {
    query.calls.push({ params, opts });
    return {
      escalations: [], total: 0, listSchema: null, singleRole: null, hasRichView: false,
      isLoading: false, isFetching: false, error: null, refetch: vi.fn(), ...query.result,
    };
  },
}));
vi.mock('../../escalation/EscalationListView', () => ({ EscalationListView: () => <div data-testid="view-rich" /> }));
vi.mock('../../escalation/EscalationTimeline', () => ({ EscalationTimeline: () => <div data-testid="view-timeline" /> }));
vi.mock('../../escalation/EscalationTableView', () => ({
  EscalationTableView: ({ layout }: { layout?: string | null }) => <div data-testid="view-table" data-layout={layout ?? ''} />,
}));

import { PortalPanel, PORTAL_PANEL_ROWS } from '../PortalPanel';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}` }));

function renderPanel(url: string, label = 'North facility') {
  return render(
    <MemoryRouter>
      <PortalPanel pin={{ label, url, badge: true }} url={url} from="/portal/fleet" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  query.calls = [];
  query.result = {};
});

describe('PortalPanel', () => {
  it('parses the pin into the shared list query with the panel row cap and shows label, count, and the open link', () => {
    query.result = { escalations: rows(3), total: 3 };
    const url = '/escalations/available?role=fleet&facets=%7B%22facility%22%3A%22north%22%7D';
    renderPanel(url);
    expect(screen.getByRole('heading', { name: 'North facility' })).toBeInTheDocument();
    expect(screen.getByTestId('portal-panel-count')).toHaveTextContent('3');
    expect(screen.getByTestId('portal-panel-open')).toHaveAttribute('href', url);
    const { params, opts } = query.calls[0];
    expect(params).toMatchObject({ statusFilter: 'available', role: 'fleet', facets: { facets: { facility: 'north' } } });
    expect(opts).toMatchObject({ limit: PORTAL_PANEL_ROWS, offset: 0, enabled: true });
    expect(screen.getByTestId('view-table')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-panel-more')).not.toBeInTheDocument();
  });

  it('renders rich when the role offers it and the pin does not refuse, timeline when asked', () => {
    query.result = { escalations: rows(1), total: 1, hasRichView: true, singleRole: 'fleet', listSchema: { 'x-lt-layout': 'facet-board' } };
    renderPanel('/escalations/available?role=fleet');
    expect(screen.getByTestId('view-rich')).toBeInTheDocument();

    renderPanel('/escalations/available?role=fleet&view=table');
    expect(screen.getByTestId('view-table')).toBeInTheDocument();

    renderPanel('/escalations/available?role=fleet&view=timeline');
    expect(screen.getByTestId('view-timeline')).toBeInTheDocument();
  });

  it('points at the full view when more rows exist than the panel shows', () => {
    query.result = { escalations: rows(PORTAL_PANEL_ROWS), total: PORTAL_PANEL_ROWS + 40 };
    renderPanel('/escalations/available?role=fleet');
    expect(screen.getByTestId('portal-panel-more')).toHaveTextContent('40 more in the full view');
  });

  it('a pin that is not an escalations list holds its query and offers the link instead', () => {
    renderPanel('/operations?lens=fleet', 'Operations');
    expect(query.calls[0].opts.enabled).toBe(false);
    expect(screen.getByText(/opens as its own page/)).toBeInTheDocument();
    expect(screen.queryByTestId('view-table')).not.toBeInTheDocument();
  });

  it('offers a view toggle when the role has a rich view, and a sort direction that reaches the query', () => {
    query.result = { escalations: rows(2), total: 2, hasRichView: true, singleRole: 'fleet', listSchema: { 'x-lt-layout': 'facet-board' } };
    renderPanel('/escalations/available?role=fleet');
    expect(screen.getByTestId('view-rich')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Table view' }));
    expect(screen.getByTestId('view-table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Oldest first' }));
    const last = query.calls[query.calls.length - 1].params as { facets: { orderBy?: { field: string; direction: string }[] } };
    expect(last.facets.orderBy).toEqual([{ field: 'created_at', direction: 'asc' }]);
  });

  it('hands the pin\'s layout hint to the table', () => {
    query.result = { escalations: rows(1), total: 1 };
    renderPanel('/escalations/available?role=fleet&view=table&layout=compact');
    expect(screen.getByTestId('view-table')).toHaveAttribute('data-layout', 'compact');
  });

  it('a plain-schema role gets no view toggle; the sort control still shows', () => {
    query.result = { escalations: rows(1), total: 1 };
    renderPanel('/escalations/available?role=fleet');
    expect(screen.queryByRole('radiogroup', { name: 'Panel view' })).not.toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Sort direction' })).toBeInTheDocument();
  });

  it('shows the query error in place of the rows', () => {
    query.result = { error: new Error('Forbidden') };
    renderPanel('/escalations/available?role=fleet');
    expect(screen.getByRole('alert')).toHaveTextContent('Forbidden');
  });
});
