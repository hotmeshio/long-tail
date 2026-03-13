import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
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
  return render(
    <QueryClientProvider client={queryClient}>
      <EscalationActionBar {...props} />
    </QueryClientProvider>,
  );
}

describe('EscalationActionBar', () => {
  // ── Terminal ──
  it('renders nothing when terminal', () => {
    const { container } = renderBar({ mode: 'terminal' });
    expect(container.querySelector('[data-testid="escalation-action-bar"]')).toBeNull();
  });

  // ── Available (claim) ──
  it('renders claim bar when available', () => {
    renderBar({ mode: 'available' });
    expect(screen.getByTestId('claim-bar')).toBeInTheDocument();
    expect(screen.getByText('Claim')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
  });

  it('renders duration options as tab row with Other', () => {
    renderBar({ mode: 'available' });
    expect(screen.getByText('15 min')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.getByText('4 hours')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('calls onClaim with selected duration', () => {
    const onClaim = vi.fn();
    renderBar({ mode: 'available', onClaim });

    fireEvent.click(screen.getByText('1 hour'));
    fireEvent.click(screen.getByText('Claim'));
    expect(onClaim).toHaveBeenCalledWith(60);
  });

  it('calls onClaim with default 30 min', () => {
    const onClaim = vi.fn();
    renderBar({ mode: 'available', onClaim });

    fireEvent.click(screen.getByText('Claim'));
    expect(onClaim).toHaveBeenCalledWith(30);
  });

  it('shows custom input when Other is clicked', () => {
    renderBar({ mode: 'available' });
    fireEvent.click(screen.getByText('Other'));
    expect(screen.getByTestId('custom-duration-input')).toBeInTheDocument();
  });

  it('calls onClaim with custom duration in minutes', () => {
    const onClaim = vi.fn();
    renderBar({ mode: 'available', onClaim });

    fireEvent.click(screen.getByText('Other'));
    fireEvent.change(screen.getByTestId('custom-duration-input-quantity'), { target: { value: '45' } });
    fireEvent.click(screen.getByText('Claim'));
    expect(onClaim).toHaveBeenCalledWith(45);
  });

  it('calls onClaim with custom duration in hours', () => {
    const onClaim = vi.fn();
    renderBar({ mode: 'available', onClaim });

    fireEvent.click(screen.getByText('Other'));
    fireEvent.change(screen.getByTestId('custom-duration-input-unit'), { target: { value: '60' } });
    fireEvent.change(screen.getByTestId('custom-duration-input-quantity'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Claim'));
    expect(onClaim).toHaveBeenCalledWith(120);
  });

  it('shows pending state on claim button', () => {
    renderBar({ mode: 'available', claimPending: true });
    expect(screen.getByText('Claiming...')).toBeInTheDocument();
  });

  it('highlights selected duration', () => {
    renderBar({ mode: 'available' });
    const thirtyMin = screen.getByText('30 min');
    expect(thirtyMin.className).toContain('text-accent');

    fireEvent.click(screen.getByText('1 hour'));
    expect(screen.getByText('1 hour').className).toContain('text-accent');
    expect(screen.getByText('30 min').className).not.toContain('font-medium');
  });

  // ── Claimed by other ──
  it('renders claimed-by-other bar', () => {
    renderBar({ mode: 'claimed_by_other', assignedTo: 'user-abc' });
    expect(screen.getByTestId('claimed-other-bar')).toBeInTheDocument();
    expect(screen.getByText('Claimed by')).toBeInTheDocument();
    expect(screen.getByText('user-abc…')).toBeInTheDocument();
  });

  // ── Claimed by me: resolve ──
  it('shows resolve controls by default when claimed', () => {
    renderBar({ mode: 'claimed_by_me' });
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('shows Send to Triage button when triage is active', () => {
    renderBar({ mode: 'claimed_by_me', requestTriage: true });
    expect(screen.getByText('Send to Triage')).toBeInTheDocument();
  });

  it('calls onResolve with parsed JSON', () => {
    const onResolve = vi.fn();
    renderBar({ mode: 'claimed_by_me', json: '{"approved": true}', onResolve });

    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalledWith({ approved: true });
  });

  it('shows parse error for invalid JSON', () => {
    renderBar({ mode: 'claimed_by_me', json: 'not json' });

    fireEvent.click(screen.getByText('Submit'));
    expect(screen.getByText('Invalid JSON')).toBeInTheDocument();
  });

  it('sends only triage payload when triage active (no form data)', () => {
    const onResolve = vi.fn();
    renderBar({
      mode: 'claimed_by_me',
      json: '{"approved": true, "analysis": {"confidence": 0.95}}',
      requestTriage: true,
      triageNotes: '',
      onResolve,
    });

    fireEvent.click(screen.getByText('Send to Triage'));
    expect(onResolve).toHaveBeenCalledWith({ _lt: { needsTriage: true } });
  });

  it('includes triage notes in payload when provided', () => {
    const onResolve = vi.fn();
    renderBar({
      mode: 'claimed_by_me',
      requestTriage: true,
      triageNotes: 'Content is in Spanish',
      onResolve,
    });

    fireEvent.click(screen.getByText('Send to Triage'));
    expect(onResolve).toHaveBeenCalledWith({
      _lt: { needsTriage: true },
      notes: 'Content is in Spanish',
    });
  });

  it('shows acknowledge for notification escalations (no workflowType)', () => {
    const onResolve = vi.fn();
    renderBar({ mode: 'claimed_by_me', workflowType: null, onResolve });
    const acknowledgeButtons = screen.getAllByText('Acknowledge');
    expect(acknowledgeButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(acknowledgeButtons[acknowledgeButtons.length - 1]);
    expect(onResolve).toHaveBeenCalledWith({ acknowledged: true });
  });

  // ── Claimed by me: escalate ──
  it('switches to escalate view', () => {
    const onActiveViewChange = vi.fn();
    renderBar({ mode: 'claimed_by_me', onActiveViewChange });
    fireEvent.click(screen.getByText('Escalate'));
    expect(onActiveViewChange).toHaveBeenCalledWith('escalate');
  });

  it('calls onEscalate with selected role', () => {
    const onEscalate = vi.fn();
    renderBar({ mode: 'claimed_by_me', activeView: 'escalate', onEscalate });

    fireEvent.change(screen.getByTestId('escalate-select'), { target: { value: 'supervisor' } });
    const buttons = screen.getAllByText('Escalate');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onEscalate).toHaveBeenCalledWith('supervisor');
  });

  it('hides escalate tab when no targets', () => {
    renderBar({ mode: 'claimed_by_me', escalationTargets: [] });
    expect(screen.queryByText('Escalate')).not.toBeInTheDocument();
  });

  // ── Claimed by me: release ──
  it('shows release view when activeView is release', () => {
    renderBar({ mode: 'claimed_by_me', activeView: 'release' });
    expect(screen.getByText('Yes, Release')).toBeInTheDocument();
  });

  it('calls onRelease', () => {
    const onRelease = vi.fn();
    renderBar({ mode: 'claimed_by_me', activeView: 'release', onRelease });

    fireEvent.click(screen.getByText('Yes, Release'));
    expect(onRelease).toHaveBeenCalled();
  });

  it('cancel release calls onActiveViewChange with resolve', () => {
    const onActiveViewChange = vi.fn();
    renderBar({ mode: 'claimed_by_me', activeView: 'release', onActiveViewChange });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onActiveViewChange).toHaveBeenCalledWith('resolve');
  });

  // ── Error display ──
  it('shows resolve error', () => {
    renderBar({ mode: 'claimed_by_me', resolveError: new Error('Server error') });
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });
});
