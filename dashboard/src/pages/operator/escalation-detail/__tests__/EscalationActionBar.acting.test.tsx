import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'station-1' } }),
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

describe('EscalationActionBar — acting identity', () => {
  it('names the badged person on their own claim with the remaining time', () => {
    renderBar({
      mode: 'claimed_by_me',
      actingName: 'Dana Reviewer',
      assignedUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const note = screen.getByTestId('acting-claim-note');
    expect(note).toHaveTextContent('Claimed by you');
    expect(note).toHaveTextContent('(Dana Reviewer)');
    // Full self-claim controls: the person submits as themselves.
    expect(screen.getByText('Submit')).toBeInTheDocument();
    // The existing remaining-time display rides along (compact "59m 59s" form).
    expect(screen.getByTestId('escalation-action-bar').textContent).toMatch(/\d+m/);
  });

  it('renders no acting note on a plain self-claim', () => {
    renderBar({ mode: 'claimed_by_me' });
    expect(screen.queryByTestId('acting-claim-note')).not.toBeInTheDocument();
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('warns up front that the submit needs a badge on a station working surface', () => {
    renderBar({ mode: 'claimed_by_me', assignedTo: 'user-abc', submitNeedsBadge: true });
    expect(screen.getByTestId('submit-badge-warning')).toHaveTextContent(
      "When you submit, you'll scan your badge to confirm you're",
    );
    expect(screen.queryByTestId('acting-claim-note')).not.toBeInTheDocument();
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('shows no submit warning on a plain self-claim', () => {
    renderBar({ mode: 'claimed_by_me', actingName: 'Dana Reviewer' });
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('acting-claim-note')).toBeInTheDocument();
  });

  it('keeps the claimed-by-other bar free of any badge line', () => {
    renderBar({ mode: 'claimed_by_other', assignedTo: 'user-abc' });
    expect(screen.queryByTestId('submit-badge-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('badge-prompt')).not.toBeInTheDocument();
  });

  it('surfaces the expired-grant error on the station working bar', () => {
    renderBar({
      mode: 'claimed_by_me',
      assignedTo: 'badge-user-1',
      submitNeedsBadge: true,
      resolveError: new Error('acting identity expired — scan your badge again'),
    });
    expect(
      screen.getByText('acting identity expired — scan your badge again'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('submit-badge-warning')).toBeInTheDocument();
  });
});
