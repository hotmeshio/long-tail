import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { renderWithProviders } from '../../../../test/render';
import { EscalationDetailPage } from '../EscalationDetailPage';

const state = vi.hoisted(() => {
  const idleMutation = () => ({
    mutate: () => {},
    mutateAsync: async () => ({}),
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
  });
  return {
    idleMutation,
    byId: {} as Record<string, Record<string, unknown>>,
    resolve: {
      mutateAsync: (async () => ({})) as (args: unknown) => Promise<unknown>,
      isPending: false,
      isSuccess: false,
      error: null as Error | null,
    },
  };
});

vi.mock('../../../../api/escalations', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useEscalation: (id: string) => ({
    data: state.byId[id],
    isLoading: false,
    refetch: () => {},
    isFetching: false,
  }),
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
  useAuth: () => ({ user: { userId: 'resolver-1' } }),
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

function makeEsc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'review',
    subtype: 'originator',
    description: `Escalation ${id}`,
    status: 'pending',
    priority: 2,
    role: 'walk-role',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    envelope: '{}',
    metadata: {},
    form_schema: null,
    escalation_payload: null,
    resolver_payload: null,
    task_id: null, origin_id: null, parent_id: null,
    workflow_id: null, task_queue: null, workflow_type: 'walk',
    assigned_to: 'resolver-1',
    assigned_until: new Date(Date.now() + 3_600_000).toISOString(),
    resolved_at: null, claimed_at: null, trace_id: null, span_id: null,
    ...overrides,
  };
}

// Parent embeds a full form on its row metadata (walk page); the child carries
// only the role-owned form the single-escalation GET joined in.
const PARENT_ID = 'esc-parent';
const CHILD_ID = 'esc-child';
const detailPath = (id: string) => `/escalations/detail/${id}`;

function seedEscalations() {
  state.byId = {
    [PARENT_ID]: makeEsc(PARENT_ID, {
      metadata: {
        form_schema: {
          properties: { bag_count: { type: 'string', title: 'Bag facts' } },
        },
      },
    }),
    [CHILD_ID]: makeEsc(CHILD_ID, {
      workflow_type: 'plate',
      form_schema: {
        properties: { plate_ok: { type: 'string', title: 'Plate check' } },
      },
    }),
  };
}

function renderAt(entries: string[], initialIndex = entries.length - 1) {
  const router = createMemoryRouter(
    [{ path: '/escalations/detail/:id', element: <EscalationDetailPage /> }],
    { initialEntries: entries, initialIndex },
  );
  return { router, ...renderWithProviders(<RouterProvider router={router} />) };
}

describe('EscalationDetailPage — per-id state isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    seedEscalations();
    state.resolve = {
      mutateAsync: vi.fn(async () => ({})),
      isPending: false,
      isSuccess: false,
      error: null,
    };
  });

  it('re-resolves the form schema when navigating between escalation ids', async () => {
    const { router } = renderAt([detailPath(PARENT_ID)]);
    expect(await screen.findByText('Bag facts')).toBeInTheDocument();

    await act(() => router.navigate(detailPath(CHILD_ID)));

    // The child renders its own role form; nothing from the parent's
    // row-embedded schema survives the id change.
    expect(await screen.findByText('Plate check')).toBeInTheDocument();
    expect(screen.queryByText('Bag facts')).not.toBeInTheDocument();
  });

  it('fires resolve at the escalation the form was rendered for, then tears the form down', async () => {
    renderAt([detailPath(PARENT_ID), detailPath(CHILD_ID)]);
    expect(await screen.findByText('Plate check')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() =>
      expect(state.resolve.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: CHILD_ID }),
      ),
    );
    expect(state.resolve.mutateAsync).toHaveBeenCalledTimes(1);

    // Post-submit goBack lands on the parent: a fresh mount with the parent's
    // own schema — the submitted child form is gone.
    expect(await screen.findByText('Bag facts')).toBeInTheDocument();
    expect(screen.queryByText('Plate check')).not.toBeInTheDocument();
  });

  it('shows the unclaimed form at full strength and wiggles Claim when it is clicked', async () => {
    state.byId[CHILD_ID] = makeEsc(CHILD_ID, {
      workflow_type: 'plate',
      assigned_to: null,
      assigned_until: null,
      form_schema: {
        properties: { plate_ok: { type: 'string', title: 'Plate check' } },
      },
    });
    const { container } = renderAt([detailPath(CHILD_ID)]);
    const label = await screen.findByText('Plate check');
    expect(container.innerHTML).not.toContain('opacity-60');

    fireEvent.click(label);
    expect(screen.getByTestId('claim-button').className).toContain('field-shake');
  });

  it('keeps Submit locked once a resolve has succeeded', async () => {
    state.resolve.isSuccess = true;
    renderAt([detailPath(CHILD_ID)]);
    const button = await screen.findByRole('button', { name: 'Submitting...' });
    expect(button).toBeDisabled();
  });
});
