import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock data ────────────────────────────────────────────────────────────────

const mockUsers = {
  users: [
    {
      id: 'u1',
      external_id: 'ext-1',
      email: 'alice@example.com',
      display_name: 'Alice',
      status: 'active' as const,
      metadata: null,
      roles: [
        { role: 'operator', type: 'member' as const, created_at: '2025-01-01T00:00:00Z' },
        { role: 'reviewer', type: 'admin' as const, created_at: '2025-01-02T00:00:00Z' },
      ],
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
    {
      id: 'u2',
      external_id: 'ext-2',
      email: null,
      display_name: null,
      status: 'active' as const,
      metadata: null,
      roles: [],
      created_at: '2025-02-01T00:00:00Z',
      updated_at: '2025-02-01T00:00:00Z',
    },
  ],
  total: 2,
};

const mockRoles = { roles: ['operator', 'reviewer', 'auditor'] };

const mockAddRole = { mutate: vi.fn(), isPending: false };
const mockRemoveRole = { mutate: vi.fn(), isPending: false };

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../../../api/users', () => ({
  useUsers: () => ({ data: mockUsers, isLoading: false }),
  useAddUserRole: () => mockAddRole,
  useRemoveUserRole: () => mockRemoveRole,
}));

vi.mock('../../../../api/roles', () => ({
  useRoles: () => ({ data: mockRoles }),
}));

vi.mock('../../../../hooks/useFilterParams', () => ({
  useFilterParams: () => ({
    pagination: {
      page: 1,
      pageSize: 25,
      offset: 0,
      totalPages: (total: number) => Math.ceil(total / 25),
      setPage: vi.fn(),
      setPageSize: vi.fn(),
    },
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import { UserRolesPage } from '../UserRolesPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/user-roles']}>
        <UserRolesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('UserRolesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page header', () => {
    renderPage();
    expect(screen.getByText('Roles & Permissions')).toBeInTheDocument();
  });

  it('displays users with their names and emails', () => {
    renderPage();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    // User without display_name shows external_id
    expect(screen.getByText('ext-2')).toBeInTheDocument();
  });

  it('displays role pills for users with roles', () => {
    renderPage();
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByText('reviewer')).toBeInTheDocument();
  });

  it('shows "No roles" for users without roles', () => {
    renderPage();
    expect(screen.getByText('No roles')).toBeInTheDocument();
  });

  it('renders Edit Roles buttons for each user', () => {
    renderPage();
    const editButtons = screen.getAllByText('Edit Roles');
    expect(editButtons).toHaveLength(2);
  });

  it('opens modal when Edit Roles is clicked for a user with roles', async () => {
    const user = userEvent.setup();
    renderPage();

    const editButtons = screen.getAllByText('Edit Roles');
    await user.click(editButtons[0]);

    // Modal title includes user name
    expect(screen.getByText('Roles — Alice')).toBeInTheDocument();
    // Current roles listed
    expect(screen.getByText('Current Roles')).toBeInTheDocument();
    expect(screen.getByText('(member)')).toBeInTheDocument();
    expect(screen.getByText('(admin)')).toBeInTheDocument();
    // Remove buttons
    const removeButtons = screen.getAllByText('Remove');
    expect(removeButtons).toHaveLength(2);
  });

  it('shows "No roles assigned" in modal for user without roles', async () => {
    const user = userEvent.setup();
    renderPage();

    const editButtons = screen.getAllByText('Edit Roles');
    await user.click(editButtons[1]);

    expect(screen.getByText('Roles — ext-2')).toBeInTheDocument();
    expect(screen.getByText('No roles assigned')).toBeInTheDocument();
  });

  it('shows Add Role form with available roles only', async () => {
    const user = userEvent.setup();
    renderPage();

    // Open modal for Alice (has operator and reviewer)
    const editButtons = screen.getAllByText('Edit Roles');
    await user.click(editButtons[0]);

    // Only 'auditor' should be available since operator and reviewer are already assigned
    expect(screen.getByText('Add Role')).toBeInTheDocument();
    const roleSelect = screen.getByDisplayValue('Select a role...');
    expect(roleSelect).toBeInTheDocument();

    // auditor option should exist
    const options = within(roleSelect as HTMLElement).getAllByRole('option');
    const optionValues = options.map((o) => o.textContent);
    expect(optionValues).toContain('auditor');
    expect(optionValues).not.toContain('operator');
    expect(optionValues).not.toContain('reviewer');
  });

  it('hides Add Role form when all roles are already assigned', async () => {
    // Override mockUsers to have a user with all roles
    const origUsers = mockUsers.users;
    mockUsers.users = [
      {
        ...origUsers[0],
        roles: [
          { role: 'operator', type: 'member' as const, created_at: '2025-01-01T00:00:00Z' },
          { role: 'reviewer', type: 'admin' as const, created_at: '2025-01-02T00:00:00Z' },
          { role: 'auditor', type: 'member' as const, created_at: '2025-01-03T00:00:00Z' },
        ],
      } as (typeof mockUsers.users)[number],
    ];

    const user = userEvent.setup();
    renderPage();

    const editButtons = screen.getAllByText('Edit Roles');
    await user.click(editButtons[0]);

    expect(screen.queryByText('Add Role')).not.toBeInTheDocument();

    // Restore
    mockUsers.users = origUsers;
  });

  it('calls addRole.mutate when Add button is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    const editButtons = screen.getAllByText('Edit Roles');
    await user.click(editButtons[0]);

    // Select auditor role
    const roleSelect = screen.getByDisplayValue('Select a role...');
    await user.selectOptions(roleSelect, 'auditor');

    // Click Add
    await user.click(screen.getByText('Add'));

    expect(mockAddRole.mutate).toHaveBeenCalledWith(
      { userId: 'u1', role: 'auditor', type: 'member' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('calls removeRole.mutate when Remove is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    const editButtons = screen.getAllByText('Edit Roles');
    await user.click(editButtons[0]);

    const removeButtons = screen.getAllByText('Remove');
    await user.click(removeButtons[0]);

    expect(mockRemoveRole.mutate).toHaveBeenCalledWith(
      { userId: 'u1', role: 'operator' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

describe('UserRolesPage — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty message when no users exist', () => {
    const origUsers = mockUsers.users;
    const origTotal = mockUsers.total;
    mockUsers.users = [];
    mockUsers.total = 0;

    renderPage();
    expect(screen.getByText('No users found')).toBeInTheDocument();

    mockUsers.users = origUsers;
    mockUsers.total = origTotal;
  });
});
