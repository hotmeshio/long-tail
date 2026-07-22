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

  it('shows Acknowledge button for notification escalations (no workflowType)', () => {
    renderBar({ mode: 'claimed_by_me', workflowType: null });
    // Tab label and button label both say Acknowledge
    const acknowledgeEls = screen.getAllByText('Acknowledge');
    expect(acknowledgeEls.length).toBeGreaterThanOrEqual(1);
  });

  it('Acknowledge runs the same validation and submits form payload', () => {
    const onResolve = vi.fn();
    const json = JSON.stringify({ approved: true, _form_schema: {
      required: ['approved'],
      properties: { approved: { type: 'boolean' } },
    }});
    renderBar({ mode: 'claimed_by_me', workflowType: null, json, onResolve });
    fireEvent.click(screen.getAllByText('Acknowledge').slice(-1)[0]);
    expect(onResolve).toHaveBeenCalledWith({ approved: true });
  });

  it('Acknowledge blocks submission when a required field is empty', () => {
    const onResolve = vi.fn();
    const json = JSON.stringify({ notes: '', _form_schema: {
      required: ['notes'],
      properties: { notes: { type: 'string' } },
    }});
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', workflowType: null, json, onResolve, onValidationErrors });
    fireEvent.click(screen.getAllByText('Acknowledge').slice(-1)[0]);
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0].some((e: { field: string }) => e.field === 'notes')).toBe(true);
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

  it('Back from release returns to the resolve view', () => {
    const onActiveViewChange = vi.fn();
    renderBar({ mode: 'claimed_by_me', activeView: 'release', onActiveViewChange });

    fireEvent.click(screen.getByText('Back'));
    expect(onActiveViewChange).toHaveBeenCalledWith('resolve');
  });

  it('Cancel tab triggers onCancel (cancel the escalation)', () => {
    const onCancel = vi.fn();
    const onActiveViewChange = vi.fn();
    renderBar({ mode: 'claimed_by_me', activeView: 'release', onCancel, onActiveViewChange });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onActiveViewChange).not.toHaveBeenCalled();
  });

  // ── Error display ──
  it('shows resolve error', () => {
    renderBar({ mode: 'claimed_by_me', resolveError: new Error('Server error') });
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });
});

// ── Required field visibility-aware validation ──
describe('EscalationActionBar — required field submit validation', () => {
  function makeJson(fields: Record<string, unknown>, schema?: Record<string, unknown>) {
    const payload: Record<string, unknown> = { ...fields };
    if (schema) payload._form_schema = schema;
    return JSON.stringify(payload);
  }

  it('blocks submit and shows required error when visible required string field is empty', () => {
    const onResolve = vi.fn();
    const onSubmitAttempt = vi.fn();
    const json = makeJson({ notes: '' }, {
      required: ['notes'],
      properties: { notes: { type: 'string' } },
    });
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onSubmitAttempt, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onSubmitAttempt).toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0].some((e: { field: string }) => e.field === 'notes')).toBe(true);
  });

  it('allows submit when visible required string field has a value', () => {
    const onResolve = vi.fn();
    const json = makeJson({ notes: 'done' }, {
      required: ['notes'],
      properties: { notes: { type: 'string' } },
    });
    renderBar({ mode: 'claimed_by_me', json, onResolve });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalled();
  });

  it('allows submit when required field is hidden via x-lt-showIf (escalation context)', () => {
    const onResolve = vi.fn();
    const onSubmitAttempt = vi.fn();
    // action is required but hidden because metadata.crew_pill is absent
    const json = makeJson({ action: '', notes: 'done' }, {
      required: ['action'],
      properties: {
        notes: { type: 'string' },
        action: { type: 'string', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    renderBar({
      mode: 'claimed_by_me',
      json,
      onResolve,
      onSubmitAttempt,
      escalationContext: { metadata: {} },
    });
    fireEvent.click(screen.getByText('Submit'));
    // hidden required field must not block
    expect(onResolve).toHaveBeenCalled();
    expect(onSubmitAttempt).not.toHaveBeenCalled();
  });

  // Chained conditions: A reveals B, B reveals C. Visibility is evaluated
  // per-field against the resolver VALUES, so the guard follows the chain.
  const CHAIN_PROPS = {
    required: ['escalation_notes'],
    properties: {
      needs_review: { type: 'boolean' },
      escalate: { type: 'boolean', 'x-lt-showIf': 'resolver.needs_review' },
      escalation_notes: { type: 'string', 'x-lt-showIf': 'resolver.escalate' },
    },
  };

  it('allows submit when a required field is hidden two levels deep (chained x-lt-showIf)', () => {
    const onResolve = vi.fn();
    // A unchecked → B hidden (and false) → C hidden: required C must not block
    const json = makeJson({ needs_review: false, escalate: false, escalation_notes: '' }, CHAIN_PROPS);
    renderBar({ mode: 'claimed_by_me', json, onResolve, escalationContext: { metadata: {} } });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalled();
  });

  it('blocks submit when the full chain is open and the required leaf is empty', () => {
    const onResolve = vi.fn();
    // A and B both true → C visible and required
    const json = makeJson({ needs_review: true, escalate: true, escalation_notes: '' }, CHAIN_PROPS);
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors, escalationContext: { metadata: {} } });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0].some((e: { field: string }) => e.field === 'escalation_notes')).toBe(true);
  });

  it('blocks submit when required field IS visible (x-lt-showIf truthy) and empty', () => {
    const onResolve = vi.fn();
    const onValidationErrors = vi.fn();
    const json = makeJson({ action: '' }, {
      required: ['action'],
      properties: {
        action: { type: 'string', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    renderBar({
      mode: 'claimed_by_me',
      json,
      onResolve,
      escalationContext: { metadata: { crew_pill: true } },
      onValidationErrors,
    });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0].some((e: { field: string }) => e.field === 'action')).toBe(true);
  });

  it('blocks submit when required object (checklist) field has all-falsy values', () => {
    const onResolve = vi.fn();
    const json = makeJson(
      { checks: { item_0: false, item_1: false } },
      {
        required: ['checks'],
        properties: { checks: { type: 'object' } },
      },
    );
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0].some((e: { field: string }) => e.field === 'checks')).toBe(true);
  });

  it('allows submit when required object (checklist) field has at least one truthy value', () => {
    const onResolve = vi.fn();
    const json = makeJson(
      { checks: { item_0: true, item_1: false } },
      {
        required: ['checks'],
        properties: { checks: { type: 'object' } },
      },
    );
    renderBar({ mode: 'claimed_by_me', json, onResolve });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalled();
  });

  it('blocks submit when a string field violates minLength', () => {
    const onResolve = vi.fn();
    const json = makeJson({ code: 'ab' }, {
      properties: { code: { type: 'string', minLength: 5 } },
    });
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0][0].message).toMatch(/minimum 5 characters/i);
  });

  it('blocks submit when a number field violates maximum', () => {
    const onResolve = vi.fn();
    const json = makeJson({ score: 150 }, {
      properties: { score: { type: 'number', maximum: 100 } },
    });
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0][0].message).toMatch(/maximum value is 100/i);
  });

  it('blocks submit when a string field violates pattern', () => {
    const onResolve = vi.fn();
    const json = makeJson({ code: 'abc' }, {
      properties: { code: { type: 'string', pattern: '^[0-9]+$', 'x-lt-pattern-error': 'Digits only' } },
    });
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0][0].message).toMatch(/digits only/i);
  });

  it('allows submit when all field constraints pass', () => {
    const onResolve = vi.fn();
    const json = makeJson({ code: '12345', score: 85 }, {
      properties: {
        code: { type: 'string', minLength: 5, maxLength: 10 },
        score: { type: 'number', minimum: 0, maximum: 100 },
      },
    });
    renderBar({ mode: 'claimed_by_me', json, onResolve });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalled();
  });

  it('allows submit when required boolean field is true', () => {
    const onResolve = vi.fn();
    const json = makeJson({ approved: true }, {
      required: ['approved'],
      properties: { approved: { type: 'boolean' } },
    });
    renderBar({ mode: 'claimed_by_me', json, onResolve });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalledWith({ approved: true });
  });

  it('blocks submit when required boolean field is false (unchecked)', () => {
    const onResolve = vi.fn();
    const json = makeJson({ approved: false }, {
      required: ['approved'],
      properties: { approved: { type: 'boolean' } },
    });
    const onValidationErrors = vi.fn();
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    expect(onValidationErrors.mock.calls[0][0].some((e: { field: string }) => e.field === 'approved')).toBe(true);
  });

  it('allows submit when an optional string field is empty', () => {
    const onResolve = vi.fn();
    const json = makeJson({ title: 'done', notes: '' }, {
      required: ['title'],
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
      },
    });
    renderBar({ mode: 'claimed_by_me', json, onResolve });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).toHaveBeenCalled();
  });

  it('reports all failing fields via onValidationErrors callback', () => {
    const onResolve = vi.fn();
    const onValidationErrors = vi.fn();
    const json = makeJson({ name: '', score: 0 }, {
      required: ['name', 'score'],
      properties: {
        name: { type: 'string' },
        score: { type: 'number', minimum: 1 },
      },
    });
    renderBar({ mode: 'claimed_by_me', json, onResolve, onValidationErrors });
    fireEvent.click(screen.getByText('Submit'));
    expect(onResolve).not.toHaveBeenCalled();
    const errors = onValidationErrors.mock.calls[0][0] as { field: string; message: string }[];
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e: { field: string }) => e.field === 'name')).toBe(true);
    expect(errors.some((e: { field: string }) => e.field === 'score')).toBe(true);
  });
});
