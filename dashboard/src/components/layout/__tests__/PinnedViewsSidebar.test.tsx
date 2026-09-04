import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { REALTIME_REFRESH, getInvalidationScheduler } from '../../../lib/realtime-refresh';

vi.mock('../../../hooks/useSidebar', () => ({ useSidebar: () => ({ collapsed: false }) }));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'u1', roles: [{ role: 'print-farm' }, { role: 'gang-harvest' }, { role: 'harvest' }] },
    isSuperAdmin: false,
    hasRoleType: () => false,
  }),
}));
type Handler = (event: any) => void;
const subscriptions: Array<{ pattern: string; handler: Handler }> = [];
vi.mock('../../../hooks/useEventContext', () => ({
  useEventSubscriptions: (patterns: string[], handler: Handler) => {
    for (const pattern of patterns) subscriptions.push({ pattern, handler });
  },
}));
vi.mock('../../../hooks/useMemberEscalationPatterns', () => ({
  useMemberEscalationPatterns: () => ['lt.events.system.escalation.>'],
}));
vi.mock('../../../api/escalations', () => ({
  useEscalations: () => ({ data: undefined }),
  useAvailableEscalations: () => ({ data: { total: 7 } }),
}));

const prefs: Record<string, unknown> = {};
vi.mock('../../../api/preferences', () => ({
  usePreferences: () => ({ data: { preferences: prefs } }),
  usePatchPreferences: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../../api/roles', () => ({
  useRoleDetails: () => ({
    data: {
      roles: [
        {
          role: 'print-farm',
          title: 'Print Farm',
          default_pins: [{ label: 'Order Queue', url: '/escalations/available?role=print-farm', badge: true }],
        },
        {
          role: 'gang-harvest',
          title: null, // display title derives from the key
          default_pins: [
            { label: 'To Harvest', url: '/escalations/available?role=gang-harvest' },
            { label: 'My Harvest', url: '/escalations?role=gang-harvest' },
          ],
        },
        // A member role with NO pins — must never contribute a group label.
        { role: 'harvest', title: 'Harvest', default_pins: [] },
      ],
    },
  }),
}));

import { PinnedViewsSidebar } from '../PinnedViewsSidebar';

function renderSidebar(qc: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PinnedViewsSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  subscriptions.length = 0;
});

describe('PinnedViewsSidebar — role-grouped pins', () => {
  it('groups role pins under their role display title (derived when unset)', () => {
    renderSidebar();
    const labels = screen.getAllByTestId('pin-group-label').map((el) => el.textContent);
    expect(labels).toEqual(['Print Farm', 'Gang Harvest']);
  });

  it('never shows a group label without visible pins', () => {
    renderSidebar();
    expect(screen.queryByText('Harvest')).not.toBeInTheDocument();
  });

  it('shows no "Pinned" umbrella when the user has no own pins', () => {
    renderSidebar();
    expect(screen.queryByText('Pinned')).not.toBeInTheDocument();
  });

  it('drops a group whose pins are all hidden', () => {
    prefs.hiddenRolePins = ['Order Queue'];
    renderSidebar();
    const labels = screen.getAllByTestId('pin-group-label').map((el) => el.textContent);
    expect(labels).toEqual(['Gang Harvest']);
    delete prefs.hiddenRolePins;
  });

  it('every pin link carries its full label as the tooltip', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /Order Queue/ })).toHaveAttribute('title', 'Order Queue');
  });

  it('badge counts render as bare tabular digits, not a pill', () => {
    renderSidebar();
    const badge = screen.getByText('7');
    expect(badge.className).toContain('tabular-nums');
    expect(badge.className).not.toContain('rounded-full');
  });

  it('group labels carry the role provenance tooltip', () => {
    renderSidebar();
    expect(screen.getAllByTestId('pin-group-label')[0]).toHaveAttribute(
      'title',
      'Print Farm — pins from the print-farm role',
    );
  });
});

describe('PinnedViewsSidebar — badge refresh discipline', () => {
  it('an event burst never invalidates synchronously — one SUMMARY-tier flush', () => {
    vi.useFakeTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    try {
      renderSidebar(qc);
      const spy = vi.spyOn(qc, 'invalidateQueries');

      act(() => {
        for (let i = 0; i < 50; i++) subscriptions[0].handler({ type: 'system.escalation.x' });
      });
      expect(spy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(REALTIME_REFRESH.SUMMARY.coalesceMs + 50);
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ queryKey: ['escalations'] });
    } finally {
      getInvalidationScheduler(qc).dispose();
      vi.useRealTimers();
    }
  });
});
