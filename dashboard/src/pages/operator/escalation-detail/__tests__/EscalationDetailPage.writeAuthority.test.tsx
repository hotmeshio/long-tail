import { screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { EscalationDetailPage } from '../EscalationDetailPage';

// Scan codes are on for the deployment. The login is a real person on their
// own device: an item claimed by someone else must keep the standard bar.
const state = vi.hoisted(() => {
  const idleMutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})), isPending: false, isSuccess: false, error: null as Error | null });
  return {
    idleMutation,
    esc: {} as Record<string, unknown>,
    auth: { user: { userId: 'person-1' }, isSuperAdmin: false, hasRoleType: ((_t: string) => false) as (t: string) => boolean },
    memberships: [] as Array<Record<string, unknown>>,
  };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: () => ({ data: state.esc, isLoading: false, refetch: () => {}, isFetching: false }),
  useClaimEscalation: () => state.idleMutation(),
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

const ESC_ID = 'esc-held';
const grant = (over: Record<string, unknown>) => ({ role: 'floor-role', type: 'member', read_scope: 'all', write_scope: 'none', created_at: '', ...over });

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [`/escalations/detail/${ESC_ID}`] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe('EscalationDetailPage — another person\'s claim, scan codes on', () => {
  beforeEach(() => {
    localStorage.clear();
    state.esc = {
      id: ESC_ID, type: 'review', subtype: 'originator', description: 'Verify the plate', status: 'pending', priority: 2,
      role: 'floor-role', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', envelope: '{}', metadata: {},
      form_schema: { properties: { plate_ok: { type: 'string', title: 'Plate check' } } },
      escalation_payload: null, resolver_payload: null, task_id: null, origin_id: null, parent_id: null,
      workflow_id: null, task_queue: null, workflow_type: 'plate',
      assigned_to: 'badge-user-1', assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
      resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
    };
    state.auth = { user: { userId: 'person-1' }, isSuperAdmin: false, hasRoleType: () => false };
    state.memberships = [grant({})];
  });

  it('a read-only station login works the item and is warned of the submit badge', async () => {
    renderPage();
    await screen.findByText('Plate check');
    expect(screen.getByTestId('submit-badge-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('claimed-other-bar')).not.toBeInTheDocument();
  });

  it('a superadmin on their own device sees claimed-by-other with the management verbs', async () => {
    state.auth = { user: { userId: 'person-1' }, isSuperAdmin: true, hasRoleType: () => false };
    state.memberships = [grant({ role: 'admin', type: 'superadmin', write_scope: 'all' })];
    renderPage();
    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.getByTestId('admin-unassign')).toBeInTheDocument();
    expect(screen.getByTestId('admin-reassign')).toBeInTheDocument();
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('an admin grant sees claimed-by-other with the management verbs', async () => {
    state.auth = { user: { userId: 'person-1' }, isSuperAdmin: false, hasRoleType: (t: string) => t === 'admin' };
    state.memberships = [grant({ type: 'admin' })];
    renderPage();
    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.getByTestId('admin-unassign')).toBeInTheDocument();
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
  });

  it('an operator with write scope sees claimed-by-other without management verbs', async () => {
    state.memberships = [grant({ write_scope: 'self' })];
    renderPage();
    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-unassign')).not.toBeInTheDocument();
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
  });

  it('memberships still loading never grant the station surface', async () => {
    state.memberships = undefined as unknown as Array<Record<string, unknown>>;
    renderPage();
    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
  });
});
