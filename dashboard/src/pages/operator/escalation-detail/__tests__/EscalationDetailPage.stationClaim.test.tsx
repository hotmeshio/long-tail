import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { EscalationDetailPage } from '../EscalationDetailPage';

// Scan codes are on. A read-only station login claims only through a badge:
// Claim asks for one, and the claim runs as whoever badges in.
const state = vi.hoisted(() => {
  const idleMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false, isSuccess: false, error: null as Error | null });
  const claim = idleMutation();
  return {
    idleMutation,
    claim,
    esc: {} as Record<string, unknown>,
    auth: { user: { userId: 'person-1' }, isSuperAdmin: false, hasRoleType: ((_t: string) => false) as (t: string) => boolean },
    memberships: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: () => ({ data: state.esc, isLoading: false, refetch: () => {}, isFetching: false }),
  useClaimEscalation: () => state.claim,
  useResolveEscalation: () => state.idleMutation(),
  useEscalateToRole: () => state.idleMutation(),
  useCancelEscalation: () => state.idleMutation(),
}));
vi.mock('../../../../api/users', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMyRoles: () => ({ data: state.memberships }),
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
vi.mock('../../../../hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('../../../../hooks/useAccess', () => ({ useAccess: () => ({ isBuilder: false }) }));
vi.mock('../../../../hooks/useEventHooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalationDetailEvents: () => {},
}));
vi.mock('../../../../hooks/useActingIdentity', () => ({
  useActingIdentity: () => ({ identity: null, prime: () => null, clear: () => {}, remainingSeconds: () => 0 }),
}));
vi.mock('../../../../hooks/useScanInput', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScanEnabled: () => true,
}));
vi.mock('../../../../components/escalation/EscalationSidePanel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EscalationSidePanel: () => null,
}));

const ESC_ID = 'esc-open';
const grant = (over: Record<string, unknown>) => ({ role: 'floor-role', type: 'member', read_scope: 'all', write_scope: 'none', created_at: '', ...over });

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [`/escalations/detail/${ESC_ID}`] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe('EscalationDetailPage: Claim at a station', () => {
  beforeEach(() => {
    localStorage.clear();
    state.claim.mutateAsync.mockClear();
    state.esc = {
      id: ESC_ID, type: 'review', subtype: 'originator', description: 'Match the order', status: 'pending', priority: 2,
      role: 'floor-role', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', envelope: '{}', metadata: {},
      form_schema: { properties: { note: { type: 'string', title: 'Note' } } },
      escalation_payload: null, resolver_payload: null, task_id: null, origin_id: null, parent_id: null,
      workflow_id: null, task_queue: null, workflow_type: 'match',
      assigned_to: null, assigned_until: null, resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
    };
    state.auth = { user: { userId: 'station-1' }, isSuperAdmin: false, hasRoleType: () => false };
    state.memberships = [grant({})];
  });

  it('a read-only station login asks for the badge, and claims nothing yet', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('claim-button'));
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(screen.getAllByText(/Scan your badge to claim/).length).toBeGreaterThan(0);
    expect(state.claim.mutateAsync).not.toHaveBeenCalled();
  });

  it('a login that writes claims at once', async () => {
    state.memberships = [grant({ write_scope: 'all' })];
    renderPage();
    fireEvent.click(await screen.findByTestId('claim-button'));
    await waitFor(() => expect(state.claim.mutateAsync).toHaveBeenCalledWith({ id: ESC_ID, durationMinutes: 30 }));
    expect(screen.queryByTestId('station-write-challenge')).not.toBeInTheDocument();
  });
});
