import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockRoles = { roles: ['admin', 'operator', 'superadmin', 'viewer'] };

const mockChains = {
  chains: [
    { source_role: 'operator', target_role: 'admin' },
    { source_role: 'operator', target_role: 'viewer' },
    { source_role: 'admin', target_role: 'superadmin' },
  ],
};

const mockEmptyChains = { chains: [] };
const mockEmptyRoles = { roles: [] };

const mockMutate = vi.fn();

let mockChainsData = mockChains;
let mockRolesData: { roles: string[] } | undefined = mockRoles;
let mockIsLoading = false;

vi.mock('../../../../api/roles', () => ({
  useRoles: () => ({ data: mockRolesData }),
  useEscalationChains: () => ({ data: mockChainsData, isLoading: mockIsLoading }),
  useAddEscalationChain: () => ({ mutate: mockMutate, isPending: false }),
  useRemoveEscalationChain: () => ({ mutate: mockMutate }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { EscalationChainsPage } from '../EscalationChainsPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/escalation-chains']}>
        <EscalationChainsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('EscalationChainsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChainsData = mockChains;
    mockRolesData = mockRoles;
    mockIsLoading = false;
  });

  it('renders the page header', () => {
    renderPage();
    expect(screen.getByText('RBAC | Role Escalations')).toBeInTheDocument();
  });

  it('renders the description text', () => {
    renderPage();
    expect(
      screen.getByText(/Configure which roles can escalate to other roles/),
    ).toBeInTheDocument();
  });

  it('renders all roles in the roles list', () => {
    renderPage();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByText('superadmin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('shows target count badges for roles with chains', () => {
    renderPage();
    // operator has 2 targets, admin has 1
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('marks superadmin with "all roles" annotation', () => {
    renderPage();
    expect(screen.getByText(/all roles/)).toBeInTheDocument();
  });

  it('shows placeholder when no role is selected', () => {
    renderPage();
    expect(
      screen.getByText('Select a role to view its escalation targets.'),
    ).toBeInTheDocument();
  });

  it('shows escalation targets when a role is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('operator'));
    expect(screen.getByText('Can escalate to:')).toBeInTheDocument();
    // "admin" appears in both the role list and the target pill
    expect(screen.getAllByText('admin').length).toBeGreaterThanOrEqual(2);
    // "viewer" target pill (also in role list)
    expect(screen.getAllByText('viewer').length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty targets message for a role with no chains', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('viewer'));
    expect(
      screen.getByText('No escalation targets configured for this role.'),
    ).toBeInTheDocument();
  });

  it('renders the add target form with available roles', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('operator'));
    expect(screen.getByText('Add Target')).toBeInTheDocument();
    expect(screen.getByText('Select a role...')).toBeInTheDocument();
  });

  it('calls remove mutation when remove button is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByText('operator'));
    // Click the remove button on the "admin" target pill
    const removeBtn = screen.getByTitle('Remove admin');
    await user.click(removeBtn);
    expect(mockMutate).toHaveBeenCalledWith({
      source_role: 'operator',
      target_role: 'admin',
    });
  });

  it('does not allow clicking superadmin role', () => {
    renderPage();
    const superadminEl = screen.getByText('superadmin').closest('div[role]');
    // superadmin has no role="button" attribute
    expect(superadminEl).toBeNull();
  });

  // ── Empty states ─────────────────────────────────────────────────────────

  it('shows "No roles found" when roles and chains are empty', () => {
    mockRolesData = mockEmptyRoles;
    mockChainsData = mockEmptyChains;
    renderPage();
    expect(screen.getByText('No roles found')).toBeInTheDocument();
  });

  it('shows loading skeleton when chains are loading', () => {
    mockIsLoading = true;
    const { container } = renderPage();
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
