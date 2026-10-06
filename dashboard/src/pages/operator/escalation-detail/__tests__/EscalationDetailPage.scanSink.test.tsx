import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { EscalationDetailPage } from '../EscalationDetailPage';

// A claimed form open on a station takes the bin scan into its x-lt-scan
// field; x-lt-scan-submit submits, and the submit still waits for the badge.
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
    interceptor: null as null | ((raw: string) => boolean),
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

vi.mock('../../../../api/users', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMyRoles: () => ({ data: [{ role: 'floor-role', type: 'member', read_scope: 'all', write_scope: 'none', created_at: '' }] }),
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
  useOptionalScanInput: () => ({
    pushCodeInterceptor: (fn: (raw: string) => boolean) => {
      state.interceptor = fn;
      return () => { state.interceptor = null; };
    },
  }),
}));

vi.mock('../../../../api/scan-codes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScanSchemes: () => ({
    data: { schemes: [{ version: 14, name: 'Bin', encoding: 'delimited', delimiter: ':', target_length: null, enabled: true, kind: 'action' }] },
  }),
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
    metadata: { binCode: 'SF-A-2' },
    form_schema: {
      'x-lt-scan-submit': true,
      required: ['binCode'],
      properties: {
        binCode: {
          type: 'string', title: 'Bin',
          'x-lt-scan': { schemes: [14], expect: ['metadata.binCode'], 'expect-error': 'This bag goes in {{expected}}.' },
        },
      },
    },
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

describe('EscalationDetailPage — a scan into the open form', () => {
  beforeEach(() => {
    localStorage.clear();
    state.esc = makeEsc();
    state.resolve = state.idleMutation();
    state.acting = null;
    state.scanEnabled = true;
    state.listeners.clear();
    state.interceptor = null;
  });

  it('the right bin fills the field, submits, and the submit waits for the badge', async () => {
    renderPage();
    await screen.findByText('Bin');
    await waitFor(() => expect(state.interceptor).not.toBeNull());

    act(() => { expect(state.interceptor!('14:0:SF-A-2')).toBe(true); });
    expect(await screen.findByTestId('station-write-challenge')).toBeInTheDocument();
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();

    primeLive('badge-user-1', 'Dana Reviewer');
    await waitFor(() => expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: ESC_ID, resolverPayload: expect.objectContaining({ binCode: 'SF-A-2' }) }),
    ));
  });

  it('the wrong bin is named in the form and nothing is submitted', async () => {
    renderPage();
    await screen.findByText('Bin');
    await waitFor(() => expect(state.interceptor).not.toBeNull());

    act(() => { state.interceptor!('14:0:SF-B-9'); });
    expect(await screen.findByText('This bag goes in SF-A-2.')).toBeInTheDocument();
    expect(screen.queryByTestId('station-write-challenge')).toBeNull();
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });

  it('a form that is not claimed takes no scans', async () => {
    state.esc = makeEsc({ assigned_to: null, assigned_until: null });
    renderPage();
    await screen.findByText('Bin');
    expect(state.interceptor).toBeNull();
  });
});
