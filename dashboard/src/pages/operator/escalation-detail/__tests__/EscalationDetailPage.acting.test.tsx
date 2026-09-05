import { screen, fireEvent, waitFor, act } from '@testing-library/react';
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
    listeners: new Set<() => void>(),
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

vi.mock('../../../../hooks/useActingIdentity', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useActingIdentity: () => {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const l = () => force((n) => n + 1);
        state.listeners.add(l);
        return () => { state.listeners.delete(l); };
      }, []);
      return {
        identity: state.acting,
        prime: () => null,
        clear: () => { setActing(null); },
        remainingSeconds: () => 600,
      };
    },
  };
});

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

function setActing(v: typeof state.acting) {
  state.acting = v;
  state.listeners.forEach((l) => l());
}

function primedAs(actorId: string, displayName: string) {
  state.acting = {
    actingToken: 'eph:v1:acting_identity:live',
    actorId,
    displayName,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

function primeLive(actorId: string, displayName: string) {
  act(() => {
    setActing({
      actingToken: 'eph:v1:acting_identity:live',
      actorId,
      displayName,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  });
}

function renderPage() {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [`/escalations/detail/${ESC_ID}`] },
  );
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
}

describe('EscalationDetailPage — acting identity on the work surface', () => {
  beforeEach(() => {
    localStorage.clear();
    state.esc = makeEsc();
    state.resolve = state.idleMutation();
    state.acting = null;
    state.scanEnabled = true;
    state.listeners.clear();
  });

  it('single-use: a held grant does not skip the submit challenge', async () => {
    primedAs('badge-user-1', 'Dana Reviewer');
    renderPage();

    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();

    primeLive('badge-user-1', 'Dana Reviewer');
    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: ESC_ID }),
      ),
    );
  });

  it('at a station, a live-claimed item is workable and warns of the submit badge', async () => {
    renderPage();

    await screen.findByText('Plate check');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByTestId('submit-badge-warning')).toHaveTextContent(
      "When you submit, you'll scan your badge to confirm you're",
    );
    expect(screen.queryByTestId('claimed-other-bar')).not.toBeInTheDocument();
  });

  it('defers the badge to submit: opens the challenge, no premature resolve', async () => {
    renderPage();

    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });

  it('fires the stashed submit once the claimant badge primes', async () => {
    renderPage();
    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByTestId('station-write-challenge');

    primeLive('badge-user-1', 'Dana Reviewer');

    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: ESC_ID }),
      ),
    );
  });

  it('names a wrong badge and holds the submit', async () => {
    renderPage();

    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByTestId('station-write-challenge');

    primeLive('badge-user-2', 'Sam Fitter');
    expect(await screen.findByTestId('wrong-badge')).toHaveTextContent('Sam Fitter');
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });

  it('guards Release behind the badge challenge too (every write owes a tap)', async () => {
    renderPage();

    await screen.findByText('Plate check');
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Release' }));

    const challenge = await screen.findByTestId('station-write-challenge');
    expect(challenge).toHaveTextContent('release');
  });

  it('off-station: an item claimed by another stays a read-only claimed-by-other bar', async () => {
    state.scanEnabled = false;
    renderPage();

    expect(await screen.findByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
  });
});
