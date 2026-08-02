import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { ActingIdentityProvider } from '../../../../hooks/useActingIdentity';
import { EscalationDetailPage } from '../EscalationDetailPage';

const state = vi.hoisted(() => {
  const spyMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
  });
  return { spyMutation, esc: null as Record<string, unknown> | null, resolve: spyMutation(), guard: { data: { escalations: [], total: 0 }, isSuccess: true } as Record<string, unknown> };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: () => ({ data: state.esc, isLoading: false, refetch: () => {}, isFetching: false }),
  useEscalations: () => state.guard, // the submit-guard query
  useClaimEscalation: () => state.spyMutation(),
  useResolveEscalation: () => state.resolve,
  useEscalateToRole: () => state.spyMutation(),
  useCancelEscalation: () => state.spyMutation(),
}));

vi.mock('../../../../api/roles', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalationTargets: () => ({ data: { targets: [] } }),
}));
vi.mock('../../../../api/workflows', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkflowConfigs: () => ({ data: [] }),
}));
vi.mock('../../../../api/settings', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSettings: () => ({ data: undefined }),
}));
vi.mock('../../../../hooks/useAuth', () => ({ useAuth: () => ({ user: { userId: 'resolver-1' } }) }));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ isBuilder: false }) }));
vi.mock('../../../../hooks/useEventHooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalationDetailEvents: () => {},
}));
vi.mock('../../../../components/escalation/EscalationSidePanel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EscalationSidePanel: () => null,
}));

const ESC_ID = 'esc-parent';

function makeParent() {
  return {
    id: ESC_ID,
    type: 'walk', subtype: 'parent',
    description: 'Close the walk',
    status: 'pending', priority: 2, role: 'walker',
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    envelope: '{}', metadata: { walkId: 'walk-7' },
    form_schema: {
      'x-lt-submit-guard': {
        query: { role: 'child', assigned: 'me', facets: { walkId: '{{metadata.walkId}}' } },
        message: '{{count}} plates still pending',
        autoResolveWhenEmpty: true,
      },
      properties: { done: { type: 'boolean', title: 'Done', default: true } },
    },
    escalation_payload: null, resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, workflow_type: 'walk',
    assigned_to: 'resolver-1',                                   // claimed by me
    assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
    resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
  };
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [`/escalations/detail/${ESC_ID}`] },
  );
  return renderWithProviders(
    <ActingIdentityProvider><RouterProvider router={router} /></ActingIdentityProvider>,
  );
}

describe('EscalationDetailPage — auto-resolve-when-empty', () => {
  beforeEach(() => {
    localStorage.clear();
    state.esc = makeParent();
    state.resolve = state.spyMutation();
  });

  it('auto-resolves the claimed parent once the guard query is confirmed empty', async () => {
    state.guard = { data: { escalations: [], total: 0 }, isSuccess: true };
    renderPage();
    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: ESC_ID, resolverPayload: { done: true } }),
      ),
    );
  });

  it('does NOT auto-resolve while children remain (blocked)', async () => {
    state.guard = { data: { escalations: [{}], total: 2 }, isSuccess: true };
    renderPage();
    expect(await screen.findByText('Done')).toBeInTheDocument();
    // Give any effects a tick; the guard blocks, so nothing resolves.
    await new Promise((r) => setTimeout(r, 50));
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });

  it('does NOT auto-resolve on an unconfirmed (loading/error) read', async () => {
    state.guard = { data: undefined, isSuccess: false };
    renderPage();
    expect(await screen.findByText('Done')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });
});
