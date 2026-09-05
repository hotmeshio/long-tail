import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { OperatorDashboard } from '../OperatorDashboard';

const state = vi.hoisted(() => ({
  escalations: [] as Record<string, unknown>[],
  listSchema: null as Record<string, unknown> | null,
  patchPrefs: vi.fn(),
  claimMutate: vi.fn(),
}));

vi.mock('../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalations: () => ({
    data: { escalations: state.escalations, total: state.escalations.length },
    isLoading: false,
    refetch: () => {},
    isFetching: false,
  }),
  useEscalationTypes: () => ({ data: { types: [] } }),
  useReleaseEscalation: () => ({ mutate: () => {} }),
  useClaimEscalation: () => ({ mutate: state.claimMutate, isPending: false }),
}));

vi.mock('../../../api/roles', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoles: () => ({ data: { roles: ['walk-role'] } }),
  useRoleDetails: () => ({ data: { roles: [{ role: 'walk-role', title: 'Walk Role' }] } }),
  useRoleListSchema: (role: string, _v?: number, enabled = true) => ({
    data: enabled && role ? { list_schema: state.listSchema } : undefined,
  }),
}));

vi.mock('../../../api/preferences', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePreferences: () => ({ data: { preferences: { pinnedViews: [] } } }),
  usePatchPreferences: () => ({ mutate: state.patchPrefs }),
}));

vi.mock('../../../api/users', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useUserName: () => ({ data: undefined }),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { userId: 'resolver-1', roles: [{ role: 'walk-role' }] },
    isSuperAdmin: false,
    hasRoleType: () => false,
  }),
}));

vi.mock('../../../hooks/useEventHooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalationListEvents: () => {},
}));

function makeClaim(id: string) {
  return {
    id,
    type: 'review',
    subtype: 'walk',
    description: `Walk ${id}`,
    status: 'pending',
    priority: 2,
    role: 'walk-role',
    workflow_type: 'walk',
    assigned_to: 'resolver-1',
    assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
    envelope: null,
    metadata: { title: `Walk ${id}` },
    escalation_payload: null, resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null, workflow_id: null, task_queue: null,
    resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };
}

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/escalations/queue${search}`]}>
      <OperatorDashboard />
    </MemoryRouter>,
  );
}

describe('OperatorDashboard — My Escalations', () => {
  beforeEach(() => {
    state.escalations = [makeClaim('e1')];
    state.listSchema = null;
    state.patchPrefs.mockReset();
    state.claimMutate.mockReset();
  });

  it('offers the pin gesture and saves the current URL as a pinned view', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Mine: walks');
    renderPage('?role=walk-role');
    fireEvent.click(screen.getByTestId('pin-current-view'));
    expect(state.patchPrefs).toHaveBeenCalledWith({
      pinnedViews: [
        expect.objectContaining({
          label: 'Mine: walks',
          url: '/escalations/queue?role=walk-role',
          badge: true,
        }),
      ],
    });
  });

  it('renders the plain table when no single role is filtered', () => {
    state.listSchema = { 'x-lt-layout': 'facet-table', 'x-lt-columns': [{ label: 'Title', value: '{{metadata.title}}' }] };
    renderPage();
    expect(screen.queryByTestId('row-action-button')).not.toBeInTheDocument();
  });

  it('inherits the role list template when that role is filtered, with view-mode actions', () => {
    state.listSchema = { 'x-lt-layout': 'facet-table', 'x-lt-columns': [{ label: 'Title', value: '{{metadata.title}}' }] };
    renderPage('?role=walk-role');
    // The rich table renders the schema's column and its row action — the
    // engineer table has neither.
    expect(screen.getByText('Walk e1')).toBeInTheDocument();
    // Claim gestures don't apply to rows the viewer already holds — the
    // template's default claim action renders as View and never claims.
    const action = screen.getByTestId('row-action-button');
    expect(action).toHaveTextContent('View');
    fireEvent.click(action);
    expect(state.claimMutate).not.toHaveBeenCalled();
  });

  it('?view=table flips the rich view back to the columns', () => {
    state.listSchema = { 'x-lt-layout': 'facet-table', 'x-lt-columns': [{ label: 'Title', value: '{{metadata.title}}' }] };
    renderPage('?role=walk-role&view=table');
    expect(screen.queryByTestId('row-action-button')).not.toBeInTheDocument();
  });
});
