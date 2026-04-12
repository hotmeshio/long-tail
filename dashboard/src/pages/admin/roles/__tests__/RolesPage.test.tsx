import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockRoles = {
  roles: [
    { role: 'admin', user_count: 3, chain_count: 2, workflow_count: 1 },
    { role: 'reviewer', user_count: 0, chain_count: 0, workflow_count: 0 },
    { role: 'operator', user_count: 5, chain_count: 1, workflow_count: 4 },
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

  it('renders role rows in the table', () => {
    renderPage();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    renderPage();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Escalations')).toBeInTheDocument();
    expect(screen.getByText('Workflows')).toBeInTheDocument();
  });

  it('displays user, chain, and workflow counts', () => {
    renderPage();
    // admin: 3 users, 2 escalations, 1 workflow
    expect(screen.getByText('3')).toBeInTheDocument();
    // operator: 5 users, 1 escalation, 4 workflows
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders escalation routing panel', () => {
    renderPage();
    expect(screen.getByText('Escalation Routing')).toBeInTheDocument();
    expect(screen.getByText('Select a role to manage its escalation targets.')).toBeInTheDocument();
  });

  it('shows empty message when no roles exist', () => {
    roleDetailsData = emptyRoles;
    renderPage();
    expect(screen.getByText('No roles found')).toBeInTheDocument();
  });

  it('shows escalation targets when a role is clicked', async () => {
    renderPage();
    // Click the operator row to select it
    await userEvent.click(screen.getByText('operator'));
    // EscalationPanel should show the selected role and its targets
    expect(screen.getByText('Can escalate to:')).toBeInTheDocument();
    // The escalation target has a remove button with a title attribute
    expect(screen.getByTitle('Remove admin')).toBeInTheDocument();
  });

  it('shows superadmin message for superadmin role', async () => {
    roleDetailsData = {
      roles: [
        { role: 'superadmin', user_count: 1, chain_count: 0, workflow_count: 0 },
      ],
    };
    renderPage();
    await userEvent.click(screen.getByText('superadmin'));
    expect(screen.getByText('Superadmins can escalate to any role implicitly.')).toBeInTheDocument();
  });
});
