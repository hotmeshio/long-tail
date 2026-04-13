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
      external_id: 'alice',
      display_name: 'Alice Smith',
      email: 'alice@example.com',
      status: 'active',
      roles: [{ role: 'admin', type: 'admin' }],
      created_at: '2025-01-15T10:00:00Z',
    },
    {
      id: 'u2',
      external_id: 'bob',
      display_name: 'Bob Jones',
      email: 'bob@example.com',
      status: 'inactive',
      roles: [{ role: 'operator', type: 'member' }],
      created_at: '2025-02-20T14:30:00Z',
    },
  ],
  total: 2,
};

const mockEmptyUsers = { users: [], total: 0 };

const mockRoles = { roles: ['admin', 'operator', 'viewer'] };

let usersReturn: ReturnType<typeof makeUsersReturn>;
function makeUsersReturn(data: typeof mockUsers | typeof mockEmptyUsers, isLoading = false) {
  return { data, isLoading };
}

// ── Mocks ────────────────────────────────────────────────────────────────────

const mutationStub = () => ({ mutate: vi.fn(), isPending: false, error: null });

vi.mock('../../../../api/users', () => ({
  useUsers: () => usersReturn,
  useDeleteUser: () => mutationStub(),
  useCreateUser: () => mutationStub(),
  useUpdateUser: () => mutationStub(),
  useAddUserRole: () => mutationStub(),
  useRemoveUserRole: () => mutationStub(),
}));

vi.mock('../../../../api/roles', () => ({
  useRoles: () => ({ data: mockRoles }),
}));

vi.mock('../../../../api/bots', () => ({
  useBots: () => ({ data: { bots: [], total: 0 }, isLoading: false }),
  useDeleteBot: () => mutationStub(),
  useCreateBot: () => mutationStub(),
  useUpdateBot: () => mutationStub(),
  useBotApiKeys: () => ({ data: { api_keys: [] } }),
  useCreateBotApiKey: () => mutationStub(),
  useRevokeBotApiKey: () => mutationStub(),
  useAddBotRole: () => mutationStub(),
  useRemoveBotRole: () => mutationStub(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderPage(route = '/admin/users') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

import { UsersPage } from '../UsersPage';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersReturn = makeUsersReturn(mockUsers);
  });

  // ── Page structure ──────────────────────────────────────────────────────

  it('renders page header with Accounts title', () => {
    renderPage();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
  });

  it('renders tab toggle with User Accounts and Service Accounts', () => {
    renderPage();
    expect(screen.getByText('User Accounts')).toBeInTheDocument();
    expect(screen.getByText('Service Accounts')).toBeInTheDocument();
  });

  it('renders Add User button', () => {
    renderPage();
    expect(screen.getByText('Add User')).toBeInTheDocument();
  });

  it('renders Status filter', () => {
    renderPage();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  // ── User list ───────────────────────────────────────────────────────────

  it('displays user names in the table', () => {
    renderPage();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  it('displays user emails', () => {
    renderPage();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('displays role pills for users', () => {
    renderPage();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
  });

  // ── Empty state ─────────────────────────────────────────────────────────

  it('shows empty message when no users exist', () => {
    usersReturn = makeUsersReturn(mockEmptyUsers);
    renderPage();
    expect(screen.getByText('No users found')).toBeInTheDocument();
  });

  // ── Loading state ───────────────────────────────────────────────────────

  it('does not show user data while loading', () => {
    usersReturn = makeUsersReturn(mockEmptyUsers, true);
    renderPage();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  // ── Tab toggle ──────────────────────────────────────────────────────────

  it('defaults to users tab showing users table', () => {
    renderPage();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Add User')).toBeInTheDocument();
  });

  it('switches to service accounts tab on click', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Service Accounts'));

    // Service accounts tab renders BotsPage; Add User button disappears
    expect(screen.queryByText('Add User')).not.toBeInTheDocument();
  });

  // ── Role panel ──────────────────────────────────────────────────────────

  it('shows role panel placeholder when no user is selected', () => {
    renderPage();
    expect(screen.getByText('Role Membership')).toBeInTheDocument();
    expect(screen.getByText('Select a user to manage their roles.')).toBeInTheDocument();
  });

  it('shows user role details when a user row is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Alice Smith'));

    // The role panel should show the selected user name and their roles
    const panel = screen.getByText('Role Membership').closest('div')!;
    expect(within(panel).getByText('Alice Smith')).toBeInTheDocument();
    expect(within(panel).getByText('Member of:')).toBeInTheDocument();
  });

  it('shows "No roles assigned" for a user with empty roles', async () => {
    usersReturn = makeUsersReturn({
      users: [
        {
          id: 'u3',
          external_id: 'carol',
          display_name: 'Carol',
          email: 'carol@example.com',
          status: 'active',
          roles: [],
          created_at: '2025-03-01T00:00:00Z',
        },
      ],
      total: 1,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByText('Carol'));
    expect(screen.getByText('No roles assigned.')).toBeInTheDocument();
  });

  it('shows Add Role section with available roles for selected user', async () => {
    const user = userEvent.setup();
    renderPage();

    // Alice has 'admin' assigned; 'operator' and 'viewer' should be available
    await user.click(screen.getByText('Alice Smith'));
    expect(screen.getByText('Add Role')).toBeInTheDocument();
    expect(screen.getByText('Select a role...')).toBeInTheDocument();
  });
});
