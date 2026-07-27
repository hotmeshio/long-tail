import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../hooks/useSidebar', () => ({ useSidebar: () => ({ collapsed: false }) }));
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'u1', roles: [{ role: 'print-farm' }, { role: 'gang-harvest' }, { role: 'harvest' }] },
  }),
}));
vi.mock('../../../hooks/useEventContext', () => ({ useEventSubscriptions: () => {} }));
vi.mock('../../../hooks/useMemberEscalationPatterns', () => ({ useMemberEscalationPatterns: () => [] }));
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

function renderSidebar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PinnedViewsSidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
