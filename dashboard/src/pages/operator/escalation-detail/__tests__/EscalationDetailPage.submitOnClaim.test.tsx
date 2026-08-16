import { screen, fireEvent, waitFor } from '@testing-library/react';
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
  return {
    spyMutation,
    esc: null as Record<string, unknown> | null,
    claim: spyMutation(),
    resolve: spyMutation(),
  };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: () => ({ data: state.esc, isLoading: false, refetch: () => {}, isFetching: false }),
  useClaimEscalation: () => state.claim,
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

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'resolver-1' }, isSuperAdmin: false, hasRoleType: () => false }),
}));

vi.mock('../../../../hooks/useAccess', () => ({
  useAccess: () => ({ isBuilder: false }),
}));

vi.mock('../../../../hooks/useEventHooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalationDetailEvents: () => {},
}));

vi.mock('../../../../components/escalation/EscalationSidePanel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EscalationSidePanel: () => null,
}));

const ESC_ID = 'esc-1';

function makeEsc(formSchema: Record<string, unknown>) {
  return {
    id: ESC_ID,
    type: 'review',
    subtype: 'originator',
    description: 'Confirm the widget',
    status: 'pending',
    priority: 2,
    role: 'reviewer',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    envelope: '{}',
    metadata: {},
    form_schema: formSchema,
    escalation_payload: null,
    resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, workflow_type: 'widget',
    assigned_to: null,          // unclaimed → the claim bar renders
    assigned_until: null,
    resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
  };
}

function renderPage(state?: Record<string, unknown>) {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: [{ pathname: `/escalations/detail/${ESC_ID}`, state }] },
  );
  return renderWithProviders(
    <ActingIdentityProvider><RouterProvider router={router} /></ActingIdentityProvider>,
  );
}

describe('EscalationDetailPage — x-lt-submit-on-claim', () => {
  beforeEach(() => {
    localStorage.clear();
    state.claim = state.spyMutation();
    state.resolve = state.spyMutation();
  });

  it('claims then resolves the seeded defaults in one gesture', async () => {
    state.esc = makeEsc({
      'x-lt-submit-on-claim': true,
      properties: { approved: { type: 'boolean', title: 'Approved', default: true } },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('claim-button'));

    await waitFor(() =>
      expect(state.claim.mutateAsync).toHaveBeenCalledWith({ id: ESC_ID, durationMinutes: 30 }),
    );
    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: ESC_ID, resolverPayload: { approved: true } }),
      ),
    );
  });

  it('renames the claim button via x-lt-labels', async () => {
    state.esc = makeEsc({
      'x-lt-submit-on-claim': true,
      'x-lt-labels': { claim: 'Claim and Submit' },
      properties: { approved: { type: 'boolean', title: 'Approved', default: true } },
    });
    renderPage();
    expect(await screen.findByText('Claim and Submit')).toBeInTheDocument();
  });

  it('claims but does not resolve when the seeded defaults fail validation', async () => {
    state.esc = makeEsc({
      'x-lt-submit-on-claim': true,
      required: ['notes'],
      properties: { notes: { type: 'string', title: 'Notes' } },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('claim-button'));

    await waitFor(() => expect(state.claim.mutateAsync).toHaveBeenCalled());
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });

  it('auto-starts (claim then resolve) on arrival with the autoStart intent — no click', async () => {
    state.esc = makeEsc({
      properties: { approved: { type: 'boolean', title: 'Approved', default: true } },
    });
    renderPage({ autoStart: true, durationMinutes: 45 });

    await waitFor(() =>
      expect(state.claim.mutateAsync).toHaveBeenCalledWith({ id: ESC_ID, durationMinutes: 45 }),
    );
    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: ESC_ID, resolverPayload: { approved: true } }),
      ),
    );
  });

  it('does not auto-start without the intent', async () => {
    state.esc = makeEsc({
      properties: { approved: { type: 'boolean', title: 'Approved', default: true } },
    });
    renderPage();

    // The form renders and nothing fires on its own.
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(state.claim.mutateAsync).not.toHaveBeenCalled();
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });

  it('does a plain claim (no resolve) when the schema does not opt in', async () => {
    state.esc = makeEsc({
      properties: { approved: { type: 'boolean', title: 'Approved', default: true } },
    });
    renderPage();

    fireEvent.click(await screen.findByTestId('claim-button'));

    await waitFor(() => expect(state.claim.mutate).toHaveBeenCalledWith({ id: ESC_ID, durationMinutes: 30 }));
    expect(state.resolve.mutateAsync).not.toHaveBeenCalled();
  });
});
