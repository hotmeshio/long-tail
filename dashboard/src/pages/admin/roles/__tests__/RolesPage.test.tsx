import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockRoles = {
  roles: [
    {
      role: 'admin', title: 'Administrator', description: null,
      form_schema: null, metadata_schema: null, properties: {},
      ops_visible: false, parent_role: null,
      sla_minutes: null, target_per_hour: null, worker_count: null,
      user_count: 3, chain_count: 2, workflow_count: 1,
    },
    {
      role: 'reviewer', title: null, description: null,
      form_schema: null, metadata_schema: null, properties: {},
      ops_visible: false, parent_role: null,
      sla_minutes: null, target_per_hour: null, worker_count: null,
      user_count: 0, chain_count: 0, workflow_count: 0,
    },
    {
      role: 'operator', title: 'Station Operator', description: null,
      form_schema: null, metadata_schema: { type: 'object', properties: { order_id: { type: 'string' } } },
      properties: {}, ops_visible: true, parent_role: null,
      sla_minutes: 30, target_per_hour: 20, worker_count: 4,
      user_count: 5, chain_count: 1, workflow_count: 4,
    },
  ],
};

const emptyRoles = { roles: [] };

// ── Mocks ────────────────────────────────────────────────────────────────────

let roleDetailsData = mockRoles;

vi.mock('../../../../api/roles', () => ({
  useRoleDetails: () => ({ data: roleDetailsData, isLoading: false }),
  useDeleteRole: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useCreateRole: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useUpdateRole: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useEscalationChains: () => ({ data: { chains: [] } }),
  useAddEscalationChain: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveEscalationChain: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/roles']}>
        <RolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { RolesPage } from '../RolesPage';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RolesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleDetailsData = mockRoles;
  });

  it('renders page header with title and Add Role button', () => {
    renderPage();
    expect(screen.getByText('Roles')).toBeInTheDocument();
    expect(screen.getByText('+ Add Role')).toBeInTheDocument();
  });

  it('renders role rows in the list', () => {
    renderPage();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  it('renders role titles when set', () => {
    renderPage();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Station Operator')).toBeInTheDocument();
  });

  it('renders triangle values for roles with ops metrics', () => {
    renderPage();
    // operator has sla_minutes=30, target_per_hour=20, worker_count=4
    // units (m / /h) appear only in the column headers (SLA/M, Target/h)
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('navigates to role detail page when a role is clicked', async () => {
    renderPage();
    await userEvent.click(screen.getByText('operator'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/roles/operator');
  });

  it('navigates to role detail page for a role with special characters', async () => {
    renderPage();
    await userEvent.click(screen.getByText('admin'));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/roles/admin');
  });

  it('shows a create-role directive when zero roles exist', () => {
    roleDetailsData = emptyRoles;
    renderPage();
    expect(screen.getByText('Create a role to get started.')).toBeInTheDocument();
  });

  it('shows search bar', () => {
    renderPage();
    expect(screen.getByPlaceholderText(/Search \d+ roles/)).toBeInTheDocument();
  });

  it('filters roles when searching', async () => {
    renderPage();
    const search = screen.getByPlaceholderText(/Search \d+ roles/);
    await userEvent.type(search, 'admin');
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  });

  it('shows a clear-search directive when search finds nothing', async () => {
    renderPage();
    const search = screen.getByPlaceholderText(/Search \d+ roles/);
    await userEvent.type(search, 'zzznomatch');
    expect(screen.getByText('Clear the search to see all roles.')).toBeInTheDocument();
  });

  it('renders table column headers', () => {
    renderPage();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByText('Member Count')).toBeInTheDocument();
    expect(screen.getByText('SLA/M')).toBeInTheDocument();
  });

  it('renders unset capacity values as empty cells (never placeholder glyphs)', () => {
    renderPage();
    // reviewer has zero/unset counts — the cells render empty so copy/paste
    // and screen readers see exactly what the eye sees.
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });
});
