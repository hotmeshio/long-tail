import { render, screen, fireEvent } from '@testing-library/react';
import { BulkActionBar } from '../BulkActionBar';

function defaultProps(): React.ComponentProps<typeof BulkActionBar> {
  return {
    selectedCount: 5,
    onClearSelection: vi.fn(),
    onSetPriority: vi.fn(),
    onClaim: vi.fn(),
    onAssign: vi.fn(),
    onEscalate: vi.fn(),
    onTriage: vi.fn(),
    isPriorityPending: false,
    isClaimPending: false,
    isAssignPending: false,
    isEscalatePending: false,
    isTriagePending: false,
    availableRoles: ['reviewer', 'engineer'],
  };
}

describe('BulkActionBar', () => {
  it('renders selected count and all action controls', () => {
    render(<BulkActionBar {...defaultProps()} />);

    expect(screen.getByText('5 selected')).toBeInTheDocument();
    expect(screen.getByText('Assign to...')).toBeInTheDocument();
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('calls onAssign when Assign to button is clicked', () => {
    const props = defaultProps();
    render(<BulkActionBar {...props} />);

    fireEvent.click(screen.getByText('Assign to...'));
    expect(props.onAssign).toHaveBeenCalledOnce();
  });

  it('calls onTriage when Triage button is clicked', () => {
    const props = defaultProps();
    render(<BulkActionBar {...props} />);

    fireEvent.click(screen.getByText('Triage'));
    expect(props.onTriage).toHaveBeenCalledOnce();
  });

  it('calls onClearSelection when Clear is clicked', () => {
    const props = defaultProps();
    render(<BulkActionBar {...props} />);

    fireEvent.click(screen.getByText('Clear'));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
  });

  it('disables all controls when assign is pending', () => {
    render(<BulkActionBar {...defaultProps()} isAssignPending={true} />);

    expect(screen.getByText('Assigning...')).toBeDisabled();
    expect(screen.getByText('Triage')).toBeDisabled();
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('disables all controls when any action is pending', () => {
    render(<BulkActionBar {...defaultProps()} isClaimPending={true} />);

    expect(screen.getByText('Assign to...')).toBeDisabled();
    expect(screen.getByText('Triage')).toBeDisabled();
  });
});
