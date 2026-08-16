import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'viewer-1' } }),
}));

import { EscalationActionBar, type EscalationActionBarProps } from '../EscalationActionBar';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderBar(overrides: Partial<EscalationActionBarProps> = {}) {
  const props: EscalationActionBarProps = {
    mode: 'available',
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

describe('EscalationActionBar — x-lt-labels overrides', () => {
  it('renders the default labels when no overrides are given', () => {
    renderBar({ mode: 'available' });
    expect(screen.getByText('Claim')).toBeInTheDocument();
    expect(screen.getByText('Cancel escalation')).toBeInTheDocument();
  });

  it('overrides the claim and cancel labels in the available bar', () => {
    renderBar({ mode: 'available', labels: { claim: 'Claim and Submit', cancel: 'Discard' } });
    expect(screen.getByText('Claim and Submit')).toBeInTheDocument();
    expect(screen.getByText('Discard')).toBeInTheDocument();
    expect(screen.queryByText('Claim')).not.toBeInTheDocument();
  });

  it('overrides submit, release, and cancel in the claimed bar', () => {
    renderBar({
      mode: 'claimed_by_me',
      labels: { submit: 'Approve', release: 'Hand back', cancel: 'Discard' },
    });
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Hand back')).toBeInTheDocument();
    expect(screen.getByText('Discard')).toBeInTheDocument();
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
  });

  it('keeps pending and triage copy independent of the submit override', () => {
    renderBar({ mode: 'claimed_by_me', labels: { submit: 'Approve' }, requestTriage: true });
    // Triage escape hatch keeps its own label even when submit is renamed.
    expect(screen.getByText('Send to Triage')).toBeInTheDocument();
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('cancel: false removes the cancel control from the available bar', () => {
    renderBar({ mode: 'available', labels: { cancel: false } });
    expect(screen.queryByText('Cancel escalation')).not.toBeInTheDocument();
    expect(screen.getByText('Claim')).toBeInTheDocument();
  });

  it('cancel: false removes the cancel control from the claimed bar, other actions intact', () => {
    renderBar({ mode: 'claimed_by_me', labels: { cancel: false } });
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
    expect(screen.getByText('Release')).toBeInTheDocument();
    expect(screen.getByText('Resolve')).toBeInTheDocument();
  });

  it('claimed-by-other shows the claim overrides only for managers', () => {
    renderBar({ mode: 'claimed_by_other', assignedTo: 'user-2', canManage: true });
    expect(screen.getByTestId('admin-reassign')).toBeInTheDocument();
    expect(screen.getByTestId('admin-unassign')).toBeInTheDocument();
  });

  it('claimed-by-other hides the overrides from non-managers', () => {
    renderBar({ mode: 'claimed_by_other', assignedTo: 'user-2' });
    expect(screen.queryByTestId('admin-reassign')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-unassign')).not.toBeInTheDocument();
  });
});
