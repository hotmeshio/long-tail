import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { EscalationActionBar, type EscalationActionBarProps } from '../EscalationActionBar';

// The guard now lives on the page; the bar simply reflects the block state it
// is handed. These tests exercise that reflection and the triage escape hatch.
vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'walker-1' } }),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderBar(overrides: Partial<EscalationActionBarProps> = {}) {
  const props: EscalationActionBarProps = {
    mode: 'claimed_by_me',
    activeView: 'resolve',
    onActiveViewChange: vi.fn(),
    onClaim: vi.fn(),
    claimPending: false,
    workflowType: 'review',
    json: '{}',
    onResolve: vi.fn(),
    resolvePending: false,
    resolveError: null,
    requestTriage: false,
    triageNotes: '',
    onRelease: vi.fn(),
    releasePending: false,
    onCancel: vi.fn(),
    assignedTo: null,
    assignedUntil: null,
    ...overrides,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <EscalationActionBar {...props} />
    </QueryClientProvider>,
  );
}

describe('EscalationActionBar — submit guard reflection', () => {
  it('disables submit and shows the message while the guard blocks', () => {
    renderBar({ submitBlocked: true, submitBlockedMessage: '2 plates still pending' });
    expect(screen.getByText('Submit')).toBeDisabled();
    expect(screen.getByTestId('submit-guard-message')).toHaveTextContent('2 plates still pending');
  });

  it('enables submit when the guard is clear', () => {
    renderBar({ submitBlocked: false });
    expect(screen.getByText('Submit')).not.toBeDisabled();
    expect(screen.queryByTestId('submit-guard-message')).not.toBeInTheDocument();
  });

  it('never gates the triage escape hatch, even while blocked', () => {
    const onResolve = vi.fn();
    renderBar({
      submitBlocked: true,
      submitBlockedMessage: '2 plates still pending',
      requestTriage: true,
      triageNotes: 'machine jammed',
      onResolve,
    });
    const button = screen.getByText('Send to Triage');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onResolve).toHaveBeenCalledWith({ _lt: { needsTriage: true }, notes: 'machine jammed' });
  });
});
