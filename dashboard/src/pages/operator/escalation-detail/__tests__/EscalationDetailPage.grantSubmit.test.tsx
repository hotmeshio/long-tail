import { fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { EscalationDetailPage } from '../EscalationDetailPage';
import { ApiError } from '../../../../api/client';

// A read-only station login works an item claimed by the badged person. A
// live grant naming the claimant carries the submit; otherwise the station
// asks for a badge first.
const state = vi.hoisted(() => {
  const idleMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false, isSuccess: false, error: null as Error | null });
  return {
    idleMutation,
    esc: {} as Record<string, unknown>,
    auth: { user: { userId: 'person-1' }, isSuperAdmin: false, hasRoleType: ((_t: string) => false) as (t: string) => boolean },
    memberships: [] as Array<Record<string, unknown>>,
    identity: null as Record<string, unknown> | null,
    resolve: vi.fn(),
  };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: () => ({ data: state.esc, isLoading: false, refetch: () => {}, isFetching: false }),
  useClaimEscalation: () => state.idleMutation(),
  useResolveEscalation: () => ({ ...state.idleMutation(), mutate: state.resolve, mutateAsync: state.resolve }),
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
  useActingIdentity: () => ({ identity: state.identity, prime: () => null, clear: () => { state.identity = null; }, remainingSeconds: () => 60 }),
}));
vi.mock('../../../../hooks/useScanInput', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScanEnabled: () => true,
}));
vi.mock('../../../../components/escalation/EscalationSidePanel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EscalationSidePanel: () => null,
}));

const ESC_ID = 'esc-held';
const grant = (over: Record<string, unknown>) => ({ role: 'floor-role', type: 'member', read_scope: 'all', write_scope: 'none', created_at: '', ...over });

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [`/escalations/detail/${ESC_ID}`] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

const badge = (over: Record<string, unknown> = {}) => ({
  actingToken: 'eph:v1:acting_identity:t', actorId: 'badge-user-1', displayName: 'Maria',
  expiresAt: new Date(Date.now() + 600_000).toISOString(), subjectScoped: false, ...over,
});

describe('EscalationDetailPage — a station submit and the live badge grant', () => {
  beforeEach(() => {
    localStorage.clear();
    state.resolve.mockReset();
    state.esc = {
      id: ESC_ID, type: 'review', subtype: 'originator', description: 'Verify the plate', status: 'pending', priority: 2,
      role: 'floor-role', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', envelope: '{}', metadata: {},
      form_schema: { properties: { plate_ok: { type: 'string', title: 'Plate check' } } },
      escalation_payload: null, resolver_payload: null, task_id: null, origin_id: null, parent_id: null,
      workflow_id: null, task_queue: null, workflow_type: 'plate',
      assigned_to: 'badge-user-1', assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
      resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
    };
    state.auth = { user: { userId: 'station-1' }, isSuperAdmin: false, hasRoleType: () => false };
    state.memberships = [grant({})];
    state.identity = null;
  });

  const submit = async () => {
    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
  };

  it('a grant naming the claimant carries the submit with no badge prompt', async () => {
    state.identity = badge();
    renderPage();
    await screen.findByText('Plate check');
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
    await submit();
    expect(screen.queryByTestId('station-write-challenge')).not.toBeInTheDocument();
    expect(state.resolve).toHaveBeenCalled();
  });

  it('the grant carries only the submit: a release still asks for the badge', async () => {
    state.identity = badge();
    renderPage();
    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: /^release$/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, Release' }));
    expect(await screen.findByTestId('station-write-challenge')).toHaveTextContent('Scan your badge to release');
  });

  it('a carried grant the server no longer honors turns into the badge challenge', async () => {
    state.identity = badge();
    // The client clears a refused grant before the error reaches the page.
    state.resolve.mockImplementationOnce(async () => {
      state.identity = null;
      throw new ApiError('acting identity expired', 401, { error: 'acting identity expired' });
    });
    renderPage();
    await submit();
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
  });

  it('with no live grant the submit asks for the badge first (a one-use badge spent by the claim)', async () => {
    renderPage();
    await screen.findByText('Plate check');
    expect(screen.getByTestId('submit-badge-warning')).toBeInTheDocument();
    await submit();
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('a grant for someone else asks for the claimant\'s badge', async () => {
    state.identity = badge({ actorId: 'someone-else', displayName: 'Ana' });
    renderPage();
    await submit();
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it('a grant bound to a scanned subject asks for a badge', async () => {
    state.identity = badge({ subjectScoped: true });
    renderPage();
    await submit();
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(state.resolve).not.toHaveBeenCalled();
  });
});
