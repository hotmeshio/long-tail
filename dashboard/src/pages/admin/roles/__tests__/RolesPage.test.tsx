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
      form_schema: null, properties: {}, ops_visible: false, parent_role: null,
      user_count: 3, chain_count: 2, workflow_count: 1,
    },
    {
      role: 'reviewer', title: null, description: null,
      form_schema: null, properties: {}, ops_visible: false, parent_role: null,
      user_count: 0, chain_count: 0, workflow_count: 0,
    },
    {
      role: 'operator', title: 'Station Operator', description: null,
      form_schema: null, properties: {}, ops_visible: true, parent_role: null,
      user_count: 5, chain_count: 1, workflow_count: 4,
    },
  ],
};

const mockChains = {
  chains: [
    { source_role: 'operator', target_role: 'admin' },
    { source_role: 'admin', target_role: 'reviewer' },
    { source_role: 'admin', target_role: 'operator' },
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
  useEscalationChains: () => ({ data: mockChains }),
  useAddEscalationChain: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveEscalationChain: () => ({ mutate: vi.fn(), isPending: false }),
}));

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
    expect(screen.getByText('Add Role')).toBeInTheDocument();
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

  it('shows ops badge for ops_visible roles', () => {
    renderPage();
    // operator has ops_visible: true — badge renders "ops" text
    const opsBadges = screen.getAllByText('ops');
    expect(opsBadges.length).toBeGreaterThan(0);
  });

  it('shows Role Detail placeholder when nothing is selected', () => {
    renderPage();
    expect(screen.getByText('Role Detail')).toBeInTheDocument();
    expect(screen.getByText(/Select a role to view/)).toBeInTheDocument();
  });

  it('shows empty message when no roles exist', () => {
    roleDetailsData = emptyRoles;
    renderPage();
    expect(screen.getByText('No roles found.')).toBeInTheDocument();
  });

  it('opens detail panel when a role is clicked', async () => {
    renderPage();
    await userEvent.click(screen.getByText('operator'));
    // Detail panel shows the role key in heading
    expect(screen.getAllByText('operator').length).toBeGreaterThanOrEqual(1);
    // Info tab is active by default — shows Display Name label
    expect(screen.getByText('Display Name')).toBeInTheDocument();
  });

  it('shows escalation targets when Escalations tab is clicked', async () => {
    renderPage();
    await userEvent.click(screen.getByText('operator'));
    await userEvent.click(screen.getByText('Escalations'));
    // EscalationPanel shows escalation targets
    expect(screen.getByTitle('Remove admin')).toBeInTheDocument();
  });

  it('shows superadmin implicit escalation message', async () => {
    roleDetailsData = {
      roles: [
        {
          role: 'superadmin', title: null, description: null,
          form_schema: null, properties: {}, ops_visible: false, parent_role: null,
          user_count: 1, chain_count: 0, workflow_count: 0,
        },
      ],
    };
    renderPage();
    await userEvent.click(screen.getByText('superadmin'));
    await userEvent.click(screen.getByText('Escalations'));
    expect(screen.getByText('Superadmins can escalate to any role implicitly.')).toBeInTheDocument();
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
});
