import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkActionBar } from '../modal/BulkActionBar';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

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

function renderBar(overrides: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <BulkActionBar {...defaultProps()} {...overrides} />
    </QueryClientProvider>,
  );
}

describe('BulkActionBar', () => {
  it('renders selected count and all action controls', () => {
    renderBar();

    expect(screen.getByText('5 selected')).toBeInTheDocument();
    expect(screen.getByText('Assign to...')).toBeInTheDocument();
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('calls onAssign when Assign to button is clicked', () => {
    const props = defaultProps();
    render(
      <QueryClientProvider client={queryClient}>
        <BulkActionBar {...props} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Assign to...'));
    expect(props.onAssign).toHaveBeenCalledOnce();
  });

  it('calls onTriage when Triage button is clicked', () => {
    const props = defaultProps();
    render(
      <QueryClientProvider client={queryClient}>
        <BulkActionBar {...props} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Triage'));
    expect(props.onTriage).toHaveBeenCalledOnce();
  });

  it('calls onClearSelection when Clear is clicked', () => {
    const props = defaultProps();
    render(
      <QueryClientProvider client={queryClient}>
        <BulkActionBar {...props} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText('Clear'));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
  });

  it('disables all controls when assign is pending', () => {
    renderBar({ isAssignPending: true });

    expect(screen.getByText('Assigning...')).toBeDisabled();
    expect(screen.getByText('Triage')).toBeDisabled();
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });

  it('disables all controls when any action is pending', () => {
    renderBar({ isClaimPending: true });

    expect(screen.getByText('Assign to...')).toBeDisabled();
    expect(screen.getByText('Triage')).toBeDisabled();
  });
});
