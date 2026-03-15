import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkAssignModal } from '../modal/BulkAssignModal';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ isSuperAdmin: true }),
}));

const mockUsers = [
  {
    id: 'u1',
    external_id: 'alice',
    display_name: 'Alice Adams',
    email: 'alice@example.com',
    status: 'active' as const,
    metadata: null,
    roles: [],
    created_at: '',
    updated_at: '',
  },
  {
    id: 'u2',
    external_id: 'bob',
    display_name: 'Bob Brown',
    email: 'bob@example.com',
    status: 'active' as const,
    metadata: null,
    roles: [],
    created_at: '',
    updated_at: '',
  },
  {
    id: 'u3',
    external_id: 'carol',
    display_name: 'Carol Chen',
    email: 'carol@example.com',
    status: 'active' as const,
    metadata: null,
    roles: [],
    created_at: '',
    updated_at: '',
  },
];

vi.mock('../../../api/users', () => ({
  useUsers: () => ({
    data: { users: mockUsers, total: mockUsers.length },
    isLoading: false,
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderModal(overrides: Partial<React.ComponentProps<typeof BulkAssignModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    open: true,
    onClose: vi.fn(),
    selectedCount: 3,
    selectedRoles: ['reviewer'],
    onSubmit: vi.fn(),
    isPending: false,
    ...overrides,
  };
  const result = render(
    <QueryClientProvider client={qc}>
      <BulkAssignModal {...props} />
    </QueryClientProvider>,
  );
  return { ...result, props };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('BulkAssignModal', () => {
  it('renders user search step when open', () => {
    renderModal();
    expect(screen.getByText('Assign Escalations')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search by name or email...')).toBeInTheDocument();
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.getByText('Bob Brown')).toBeInTheDocument();
    expect(screen.getByText('Carol Chen')).toBeInTheDocument();
  });

  it('filters users by search text', () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText('Search by name or email...'), {
      target: { value: 'bob' },
    });
    expect(screen.getByText('Bob Brown')).toBeInTheDocument();
    expect(screen.queryByText('Alice Adams')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol Chen')).not.toBeInTheDocument();
  });

  it('advances to duration step on user click', () => {
    renderModal();
    fireEvent.click(screen.getByText('Alice Adams'));

    // Duration step shows user name and duration dropdown
    expect(screen.getByText(/Alice Adams/)).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
    expect(screen.getByText('Assign')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('returns to user step on Back', () => {
    renderModal();
    fireEvent.click(screen.getByText('Bob Brown'));
    fireEvent.click(screen.getByText('Back'));

    expect(screen.getByPlaceholderText('Search by name or email...')).toBeInTheDocument();
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
  });

  it('calls onSubmit with selected user and duration', () => {
    const { props } = renderModal();
    fireEvent.click(screen.getByText('Carol Chen'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '60' } });
    fireEvent.click(screen.getByText('Assign'));

    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onSubmit).toHaveBeenCalledWith('u3', 60);
  });

  it('disables Assign button when pending', () => {
    renderModal({ isPending: true });
    fireEvent.click(screen.getByText('Alice Adams'));

    const btn = screen.getByText('Assigning...');
    expect(btn).toBeDisabled();
  });

  it('resets state when closed via close button', () => {
    renderModal();
    // Navigate to duration step
    fireEvent.click(screen.getByText('Alice Adams'));
    expect(screen.getByText('Back')).toBeInTheDocument();

    // Click × to trigger handleClose (resets internal state + calls onClose)
    fireEvent.click(screen.getByText('×'));

    // The component's handleClose resets step to 'user' before calling onClose.
    // Since the modal is still rendered (open prop hasn't changed), verify state is reset.
    expect(screen.getByPlaceholderText('Search by name or email...')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByText('Assign Escalations')).not.toBeInTheDocument();
  });
});
