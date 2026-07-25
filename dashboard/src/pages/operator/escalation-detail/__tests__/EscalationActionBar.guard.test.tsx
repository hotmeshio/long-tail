import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EscalationActionBar, type EscalationActionBarProps } from '../EscalationActionBar';

const mockUseEscalations = vi.fn();

vi.mock('../../../../api/escalations', () => ({
  useEscalations: (...args: unknown[]) => mockUseEscalations(...args),
}));

vi.mock('../../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 'walker-1' } }),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const GUARDED_SCHEMA = {
  'x-lt-submit-guard': {
    query: { role: 'print-harvest', facets: { walkId: '{{metadata.walkId}}' } },
    mustBeEmpty: true,
    message: '{{count}} plates still pending',
  },
  type: 'object',
  properties: {},
};

function renderBar(overrides: Partial<EscalationActionBarProps> = {}) {
  const props: EscalationActionBarProps = {
    mode: 'claimed_by_me',
    activeView: 'resolve',
    onActiveViewChange: vi.fn(),
    onClaim: vi.fn(),
    claimPending: false,
    workflowType: 'review',
    json: JSON.stringify({ _form_schema: GUARDED_SCHEMA }),
    onResolve: vi.fn(),
    resolvePending: false,
    resolveError: null,
    requestTriage: false,
    triageNotes: '',
    currentRole: 'harvester',
    escalationTargets: [],
    onEscalate: vi.fn(),
    escalatePending: false,
    escalateError: null,
    onRelease: vi.fn(),
    releasePending: false,
    onCancel: vi.fn(),
    assignedTo: null,
    assignedUntil: null,
    escalationContext: { metadata: { walkId: 'walk-7' } },
    ...overrides,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <EscalationActionBar {...props} />
    </QueryClientProvider>,
  );
}

describe('EscalationActionBar — x-lt-submit-guard', () => {
  beforeEach(() => {
    mockUseEscalations.mockReset();
    mockUseEscalations.mockReturnValue({ data: { escalations: [], total: 0 } });
  });

  it('disables submit and shows the count message while guarded rows remain', () => {
    mockUseEscalations.mockReturnValue({ data: { escalations: [{}], total: 2 } });
    renderBar();
    expect(screen.getByText('Submit')).toBeDisabled();
    expect(screen.getByTestId('submit-guard-message')).toHaveTextContent('2 plates still pending');
  });

  it('enables submit when the guarded query is empty', () => {
    renderBar();
    expect(screen.getByText('Submit')).not.toBeDisabled();
    expect(screen.queryByTestId('submit-guard-message')).not.toBeInTheDocument();
  });

  it('never gates the triage escape hatch', () => {
    mockUseEscalations.mockReturnValue({ data: { escalations: [{}], total: 2 } });
    const onResolve = vi.fn();
    renderBar({ requestTriage: true, triageNotes: 'machine jammed', onResolve });
    const button = screen.getByText('Send to Triage');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onResolve).toHaveBeenCalledWith({ _lt: { needsTriage: true }, notes: 'machine jammed' });
  });

  it('stays unguarded when the schema declares no x-lt-submit-guard', () => {
    renderBar({ json: JSON.stringify({ _form_schema: { type: 'object', properties: {} } }) });
    const call = mockUseEscalations.mock.calls[0][0];
    expect(call.enabled).toBe(false);
    expect(screen.getByText('Submit')).not.toBeDisabled();
  });
});
