import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const state = vi.hoisted(() => ({
  roles: [] as Record<string, unknown>[],
  fetched: true,
  user: { userId: 'u1', roles: [{ role: 'fleet' }] } as Record<string, unknown>,
  patterns: [] as string[],
  handler: null as ((event: { type: string }) => void) | null,
  invalidate: vi.fn(),
}));

vi.mock('../../../api/roles', () => ({ useRoleDetails: () => ({ data: { roles: state.roles }, isFetched: state.fetched }) }));
vi.mock('../../../hooks/useLinkVariables', () => ({ useLinkVariables: () => ({ resolveUrl: (u: string) => u }) }));
vi.mock('../../../hooks/useEventContext', () => ({
  useEventSubscriptions: (p: string[], h: (event: { type: string }) => void) => { state.patterns = p; state.handler = h; },
}));
vi.mock('../../../hooks/useEventHooks', () => ({ useThrottledInvalidation: () => state.invalidate }));
vi.mock('../../../components/portal/PortalGrid', () => ({
  PortalGrid: ({ rows }: { rows: unknown[][] }) => <div data-testid="grid">{rows.map((r) => r.length).join('/')}</div>,
}));
vi.mock('../../../components/portal/PortalCounts', () => ({
  PortalCounts: ({ counts }: { counts: { label: string }[] }) => counts.length ? <div data-testid="counts">{counts.map((c) => c.label).join(',')}</div> : null,
}));

import { PortalPage } from '../PortalPage';

const pin = (label: string, url: string) => ({ label, url });
const FLEET = {
  role: 'fleet',
  title: 'Printer Fleet',
  portals: [
    {
      key: 'floor',
      label: 'Floor screen',
      rows: [
        [pin('Board', '/escalations/available?role=fleet&view=rich')],
        [pin('North', '/escalations/available?role=fleet&facets=%7B%22f%22%3A%22n%22%7D'), pin('Harvest', '/escalations/available?role=harvest')],
      ],
    },
    {
      key: 'focus',
      label: 'Focus of the day',
      counts: [{ label: 'Waiting', url: '/escalations/available?role=triage' }],
      rows: [[pin('Jim', '/escalations/available?role=fleet'), pin('Sally', '/escalations/available?role=fleet')]],
    },
  ],
};

function renderPage(path = '/portal/fleet') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/portal/:role/:portal?" element={<PortalPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.roles = [FLEET];
  state.fetched = true;
  state.user = { userId: 'u1', roles: [{ role: 'fleet' }] };
  state.patterns = [];
  state.handler = null;
  state.invalidate.mockClear();
});

describe('PortalPage', () => {
  it('with no key, heads the page with the role title and the first portal and renders its matrix', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Printer Fleet' })).toBeInTheDocument();
    expect(screen.getByTestId('portal-title')).toHaveTextContent('Floor screen');
    expect(screen.getByText('3 views')).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toHaveTextContent('1/2');
  });

  it('a key selects the named portal, its counts lead the page and join the subscription; an unknown key reads as such', () => {
    renderPage('/portal/fleet/focus');
    expect(screen.getByTestId('portal-title')).toHaveTextContent('Focus of the day');
    expect(screen.getByTestId('counts')).toHaveTextContent('Waiting');
    expect(screen.getByTestId('grid')).toHaveTextContent('2');
    expect(state.patterns).toEqual([
      'lt.events.system.escalation.fleet.*.>',
      'lt.events.system.escalation.triage.*.>',
    ]);
    renderPage('/portal/fleet/nope');
    expect(screen.getByText(/no portal by that name/)).toBeInTheDocument();
  });

  it('subscribes once per queue the cells name and refreshes only the moved queue', () => {
    renderPage();
    expect(state.patterns).toEqual([
      'lt.events.system.escalation.fleet.*.>',
      'lt.events.system.escalation.harvest.*.>',
    ]);
    state.handler!({ type: 'system.escalation.harvest.e1.claimed' });
    expect(state.invalidate).toHaveBeenLastCalledWith([
      ['escalations', { role: 'harvest' }],
      ['escalations', 'available', { role: 'harvest' }],
    ]);
  });

  it('a role without a portal reads as such', () => {
    state.roles = [{ role: 'fleet', title: 'Printer Fleet', portals: null }];
    renderPage();
    expect(screen.getByText(/declares no portal yet/)).toBeInTheDocument();
    expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
  });

  it('opens for any signed-in user; the panels themselves are scoped server-side', () => {
    state.user = { userId: 'u2', roles: [{ role: 'other' }] };
    renderPage();
    expect(screen.getByTestId('grid')).toBeInTheDocument();
  });
});
