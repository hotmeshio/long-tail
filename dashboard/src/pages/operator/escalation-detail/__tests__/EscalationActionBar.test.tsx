import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { EscalationActionBar, type EscalationActionBarProps } from '../EscalationActionBar';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function withProviders(ui: React.ReactElement) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function makeProps(overrides: Partial<EscalationActionBarProps> = {}): EscalationActionBarProps {
  return {
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
    currentRole: 'reviewer',
    escalationTargets: ['supervisor'],
    onEscalate: vi.fn(),
    escalatePending: false,
    escalateError: null,
    onRelease: vi.fn(),
    releasePending: false,
    assignedTo: null,
    assignedUntil: null,
    ...overrides,
  };
}

describe('EscalationActionBar', () => {
  // ── Terminal ──
  it('renders nothing when terminal', () => {
    const { container } = render(<EscalationActionBar {...makeProps({ mode: 'terminal' })} />);
    expect(container.innerHTML).toBe('');
  });

  // ── Available (claim) ──
  it('renders claim bar when available', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'available' })} />);
    expect(screen.getByTestId('claim-bar')).toBeInTheDocument();
    expect(screen.getByText('Claim')).toBeInTheDocument();
    expect(screen.getByText('30 minutes')).toBeInTheDocument();
  });

  it('renders duration options as tab row', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'available' })} />);
    expect(screen.getByText('15 minutes')).toBeInTheDocument();
    expect(screen.getByText('30 minutes')).toBeInTheDocument();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('4 hours')).toBeInTheDocument();
  });

  it('calls onClaim with selected duration', () => {
    const onClaim = vi.fn();
    render(<EscalationActionBar {...makeProps({ mode: 'available', onClaim })} />);

    fireEvent.click(screen.getByText('1 hour'));
    fireEvent.click(screen.getByText('Claim'));
    expect(onClaim).toHaveBeenCalledWith(60);
  });

  it('calls onClaim with default 30 minutes', () => {
    const onClaim = vi.fn();
    render(<EscalationActionBar {...makeProps({ mode: 'available', onClaim })} />);

    fireEvent.click(screen.getByText('Claim'));
    expect(onClaim).toHaveBeenCalledWith(30);
  });

  it('shows pending state on claim button', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'available', claimPending: true })} />);
    expect(screen.getByText('Claiming...')).toBeInTheDocument();
  });

  it('highlights selected duration', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'available' })} />);
    const thirtyMin = screen.getByText('30 minutes');
    expect(thirtyMin.className).toContain('text-accent');

    fireEvent.click(screen.getByText('1 hour'));
    expect(screen.getByText('1 hour').className).toContain('text-accent');
    expect(screen.getByText('30 minutes').className).not.toContain('font-medium');
  });

  // ── Claimed by other ──
  it('renders claimed-by-other bar', () => {
    render(withProviders(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_other',
      assignedTo: 'user-abc',
    })} />));
    expect(screen.getByTestId('claimed-other-bar')).toBeInTheDocument();
    // UserName shows truncated ID while loading
    expect(screen.getByText('Claimed by')).toBeInTheDocument();
    expect(screen.getByText('user-abc…')).toBeInTheDocument();
  });

  // ── Claimed by me: resolve ──
  it('shows resolve controls by default when claimed', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'claimed_by_me' })} />);
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('shows triage checkbox with pill styling', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'claimed_by_me' })} />);
    expect(screen.getByTestId('triage-checkbox')).toBeInTheDocument();
    expect(screen.getByText('AI Triage')).toBeInTheDocument();
  });

  it('shows triage notes when triage checked', () => {
    render(<EscalationActionBar {...makeProps({ mode: 'claimed_by_me' })} />);
    fireEvent.click(screen.getByTestId('triage-checkbox'));
    expect(screen.getByTestId('triage-notes')).toBeInTheDocument();
    expect(screen.getByText('Resolve & Triage')).toBeInTheDocument();
  });

  it('calls onResolve with parsed JSON', () => {
    const onResolve = vi.fn();
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      json: '{"approved": true}',
      onResolve,
    })} />);

    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalledWith({ approved: true });
  });

  it('shows parse error for invalid JSON', () => {
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      json: 'not json',
    })} />);

    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
  });

  it('adds triage payload when checked', () => {
    const onResolve = vi.fn();
    render(<EscalationActionBar {...makeProps({ mode: 'claimed_by_me', onResolve })} />);

    fireEvent.click(screen.getByTestId('triage-checkbox'));
    fireEvent.click(screen.getByText('Resolve & Triage'));
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ _lt: { needsTriage: true } }),
    );
  });

  it('shows acknowledge for notification escalations (no workflowType)', () => {
    const onResolve = vi.fn();
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      workflowType: null,
      onResolve,
    })} />);
    const acknowledgeButtons = screen.getAllByText('Acknowledge');
    expect(acknowledgeButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(acknowledgeButtons[acknowledgeButtons.length - 1]);
    expect(onResolve).toHaveBeenCalledWith({ acknowledged: true });
  });

  // ── Claimed by me: escalate ──
  it('switches to escalate view', () => {
    const onActiveViewChange = vi.fn();
    render(<EscalationActionBar {...makeProps({ mode: 'claimed_by_me', onActiveViewChange })} />);
    fireEvent.click(screen.getByText('Escalate'));
    expect(onActiveViewChange).toHaveBeenCalledWith('escalate');
  });

  it('calls onEscalate with selected role', () => {
    const onEscalate = vi.fn();
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      activeView: 'escalate',
      onEscalate,
    })} />);

    fireEvent.change(screen.getByTestId('escalate-select'), { target: { value: 'supervisor' } });
    const buttons = screen.getAllByText('Escalate');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onEscalate).toHaveBeenCalledWith('supervisor');
  });

  it('hides escalate tab when no targets', () => {
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      escalationTargets: [],
    })} />);
    expect(screen.queryByText('Escalate')).not.toBeInTheDocument();
  });

  // ── Claimed by me: release ──
  it('shows release view when activeView is release', () => {
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      activeView: 'release',
    })} />);
    expect(screen.getByText('Yes, Release')).toBeInTheDocument();
  });

  it('calls onRelease', () => {
    const onRelease = vi.fn();
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      activeView: 'release',
      onRelease,
    })} />);

    fireEvent.click(screen.getByText('Yes, Release'));
    expect(onRelease).toHaveBeenCalled();
  });

  it('cancel release calls onActiveViewChange with resolve', () => {
    const onActiveViewChange = vi.fn();
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      activeView: 'release',
      onActiveViewChange,
    })} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onActiveViewChange).toHaveBeenCalledWith('resolve');
  });

  // ── Button alignment consistency ──
  it('claim button is right-aligned', () => {
    const { container } = render(<EscalationActionBar {...makeProps({ mode: 'available' })} />);
    const claimBar = screen.getByTestId('claim-bar');
    // Action row has flex-1 spacer before button
    const actionRow = claimBar.querySelector('.flex.items-center:last-child');
    expect(actionRow?.querySelector('.flex-1')).toBeInTheDocument();
  });

  // ── Error display ──
  it('shows resolve error', () => {
    render(<EscalationActionBar {...makeProps({
      mode: 'claimed_by_me',
      resolveError: new Error('Server error'),
    })} />);
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });
});
