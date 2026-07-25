import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'viewer-1' } }),
}));

import { EscalationActionBar, type EscalationActionBarProps } from '../EscalationActionBar';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

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
    currentRole: 'reviewer',
    escalationTargets: [],
    onEscalate: vi.fn(),
    escalatePending: false,
    escalateError: null,
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

describe('EscalationActionBar — claim nudge', () => {
  it('the claim button rests still until the first nudge', () => {
    renderBar({ claimNudge: 0 });
    expect(screen.getByTestId('claim-button').className).not.toContain('field-shake');
  });

  it('a nudge wiggles the claim button', () => {
    renderBar({ claimNudge: 1 });
    expect(screen.getByTestId('claim-button').className).toContain('field-shake');
  });
});
