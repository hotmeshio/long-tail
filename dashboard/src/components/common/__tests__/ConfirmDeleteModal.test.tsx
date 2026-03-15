import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDeleteModal } from '../modal/ConfirmDeleteModal';

describe('ConfirmDeleteModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Delete User',
    description: 'Are you sure you want to delete this user?',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and description when open', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    expect(screen.getByText('Delete User')).toBeInTheDocument();
    expect(
      screen.getByText('Are you sure you want to delete this user?'),
    ).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<ConfirmDeleteModal {...defaultProps} open={false} />);
    expect(screen.queryByText('Delete User')).not.toBeInTheDocument();
  });

  it('calls onConfirm when Delete is clicked', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onClose when Cancel is clicked', () => {
    render(<ConfirmDeleteModal {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it('shows "Deleting..." and disables button when isPending', () => {
    render(<ConfirmDeleteModal {...defaultProps} isPending />);
    const btn = screen.getByText('Deleting...');
    expect(btn).toBeDisabled();
  });

  it('displays error message when error is provided', () => {
    render(
      <ConfirmDeleteModal
        {...defaultProps}
        error={new Error('Failed to delete')}
      />,
    );
    expect(screen.getByText('Failed to delete')).toBeInTheDocument();
  });
});
