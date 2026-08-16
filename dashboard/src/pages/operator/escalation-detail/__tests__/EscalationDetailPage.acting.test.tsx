import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { EscalationDetailPage } from '../EscalationDetailPage';

// A shared station device: the session is the read-only station account; a
// badge scan primes the acting identity that must own the claim comparisons.
const state = vi.hoisted(() => {
  const idleMutation = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
  });
  return {
    idleMutation,
    esc: {} as Record<string, unknown>,
    resolve: idleMutation(),
    acting: null as null | { actingToken: string; actorId: string; displayName: string; expiresAt: string | null },
    scanEnabled: true,
  };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: () => ({ data: state.esc, isLoading: false, refetch: () => {}, isFetching: false }),
  useClaimEscalation: () => state.idleMutation(),
  useResolveEscalation: () => state.resolve,
  useEscalateToRole: () => state.idleMutation(),
  useCancelEscalation: () => state.idleMutation(),
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

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'station-1' }, isSuperAdmin: false, hasRoleType: () => false }),
}));

vi.mock('../../../../hooks/useAccess', () => ({
  useAccess: () => ({ isBuilder: false }),
}));

vi.mock('../../../../hooks/useEventHooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalationDetailEvents: () => {},
}));

vi.mock('../../../../hooks/useActingIdentity', () => ({
  useActingIdentity: () => ({
    identity: state.acting,
    prime: () => null,
    clear: () => { state.acting = null; },
    remainingSeconds: () => 600,
  }),
}));

vi.mock('../../../../hooks/useScanInput', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScanEnabled: () => state.scanEnabled,
}));

vi.mock('../../../../components/escalation/EscalationSidePanel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EscalationSidePanel: () => null,
}));

const ESC_ID = 'esc-badge';

function makeEsc(overrides: Record<string, unknown> = {}) {
  return {
    id: ESC_ID,
    type: 'review',
    subtype: 'originator',
    description: 'Verify the plate',
    status: 'pending',
    priority: 2,
    role: 'floor-role',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    envelope: '{}',
    metadata: {},
    form_schema: { properties: { plate_ok: { type: 'string', title: 'Plate check' } } },
    escalation_payload: null,
    resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, workflow_type: 'plate',
    assigned_to: 'badge-user-1',
    assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
    resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
    ...overrides,
  };
}

function primedAs(actorId: string, displayName: string) {
  state.acting = {
    actingToken: 'eph:v1:acting_identity:live',
    actorId,
    displayName,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [`/escalations/detail/${ESC_ID}`] },
  );
  return renderWithProviders(<RouterProvider router={router} />);
}

describe('EscalationDetailPage — acting identity on the work surface', () => {
  beforeEach(() => {
    localStorage.clear();
    state.esc = makeEsc();
    state.resolve = state.idleMutation();
    state.acting = null;
    state.scanEnabled = true;
  });

  it('recognizes the badged person\'s own claim under the station session', async () => {
    primedAs('badge-user-1', 'Dana Reviewer');
    renderPage();

    const note = await screen.findByTestId('acting-claim-note');
    expect(note).toHaveTextContent('Claimed by you');
    expect(note).toHaveTextContent('(Dana Reviewer)');
    // The full self-claim surface: unlocked form + Submit, no claimed-by-other bar.
    expect(screen.getByText('Submit')).toBeInTheDocument();
    expect(screen.queryByTestId('claimed-other-bar')).not.toBeInTheDocument();
  });

  it('submits the form as the badged person (resolve fires normally)', async () => {
    primedAs('badge-user-1', 'Dana Reviewer');
    renderPage();

    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: ESC_ID }),
      ),
    );
  });

  it('keeps claimed-by-other for a genuinely different claimant while primed', async () => {
    primedAs('badge-user-2', 'Sam Fitter');
    renderPage();

    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('acting-claim-note')).not.toBeInTheDocument();
    // A badge is already primed — the quiet line would be noise.
    expect(screen.queryByTestId('badge-prompt')).not.toBeInTheDocument();
  });

  it('offers the quiet badge line when unprimed, scan-enabled, and claimed by another', async () => {
    renderPage();

    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.getByTestId('badge-prompt')).toHaveTextContent(
      'If this is your claim, scan your badge.',
    );
  });

  it('stays quiet when scan capture is disabled', async () => {
    state.scanEnabled = false;
    renderPage();

    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('badge-prompt')).not.toBeInTheDocument();
  });
});
