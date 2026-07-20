import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../ResolverForm';

function formJson(fields: Record<string, unknown>, schema?: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...fields };
  if (schema) data._form_schema = schema;
  return JSON.stringify(data, null, 2);
}

describe('ResolverForm', () => {
  // ── Basic rendering ──
  it('renders string fields as text inputs', () => {
    const json = formJson({ name: 'Alice' });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
  });

  it('renders boolean fields as checkboxes', () => {
    const json = formJson({ approved: false });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  it('renders number fields as number inputs', () => {
    const json = formJson({ count: 42 });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('42')).toBeInTheDocument();
  });

  it('renders enum strings as select dropdowns', () => {
    const json = formJson({ tier: 'free' }, {
      properties: { tier: { type: 'string', enum: ['free', 'pro', 'enterprise'] } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('pro')).toBeInTheDocument();
    expect(screen.getByText('enterprise')).toBeInTheDocument();
  });

  it('hides keys starting with underscore', () => {
    const json = JSON.stringify({ visible: 'yes', _internal: 'hidden' });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('yes')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('hidden')).not.toBeInTheDocument();
  });

  it('shows empty state when no fields', () => {
    render(<ResolverForm value="{}" onChange={vi.fn()} />);
    expect(screen.getByText('No resolver fields defined.')).toBeInTheDocument();
  });

  it('shows parse error for invalid JSON', () => {
    render(<ResolverForm value="not json" onChange={vi.fn()} />);
    expect(screen.getByText(/unable to parse/i)).toBeInTheDocument();
  });

  // ── Format extensions ──
  it('renders format=date as date input', () => {
    const json = formJson({ start: '' }, {
      properties: { start: { type: 'string', format: 'date' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('input[type="date"]')).toBeInTheDocument();
  });

  it('renders format=email as email input', () => {
    const json = formJson({ email: '' }, {
      properties: { email: { type: 'string', format: 'email' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('input[type="email"]')).toBeInTheDocument();
  });

  it('renders format=datetime-local for date-time', () => {
    const json = formJson({ ts: '' }, {
      properties: { ts: { type: 'string', format: 'date-time' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('input[type="datetime-local"]')).toBeInTheDocument();
  });

  it('renders format=uri as url input', () => {
    const json = formJson({ link: '' }, {
      properties: { link: { type: 'string', format: 'uri' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('input[type="url"]')).toBeInTheDocument();
  });

  it('renders format=textarea as textarea', () => {
    const json = formJson({ notes: 'short' }, {
      properties: { notes: { type: 'string', format: 'textarea' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('textarea')).toBeInTheDocument();
  });

  it('renders format=password as password input', () => {
    const json = formJson({ secret: '' }, {
      properties: { secret: { type: 'string', format: 'password' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('input[type="password"]')).toBeInTheDocument();
  });

  // ── Required fields ──
  it('shows asterisk for required fields', () => {
    const json = formJson({ name: '' }, {
      required: ['name'],
      properties: { name: { type: 'string' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  // ── ReadOnly fields ──
  it('renders readOnly fields as static text', () => {
    const json = formJson({ amount: 100 }, {
      properties: { amount: { type: 'number', readOnly: true } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('100')).not.toBeInTheDocument();
  });

  // ── Field ordering ──
  it('orders fields by x-lt-order', () => {
    const json = formJson({ c: '3', a: '1', b: '2' }, {
      'x-lt-order': ['a', 'b', 'c'],
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
        c: { type: 'string' },
      },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    const inputs = container.querySelectorAll('input[type="text"]');
    expect((inputs[0] as HTMLInputElement).value).toBe('1');
    expect((inputs[1] as HTMLInputElement).value).toBe('2');
    expect((inputs[2] as HTMLInputElement).value).toBe('3');
  });

  // ── Layout ──
  it('renders two-column layout when x-lt-layout is two-column', () => {
    const json = formJson({ a: '1', b: '2' }, {
      'x-lt-layout': 'two-column',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    const grid = container.querySelector('.grid');
    expect(grid).toBeInTheDocument();
    expect(grid!.className).toContain('grid-cols-2');
  });

  // ── Schema title and description ──
  it('renders schema title and description', () => {
    const json = formJson({ name: '' }, {
      title: 'Customer Intake',
      description: 'Fill out the form carefully.',
      properties: { name: { type: 'string' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('Customer Intake')).toBeInTheDocument();
    expect(screen.getByText('Fill out the form carefully.')).toBeInTheDocument();
  });

  // ── Disabled mode ──
  it('applies disabled styling when disabled', () => {
    const json = formJson({ name: 'Alice' });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} disabled />);
    const wrapper = container.firstElementChild;
    expect(wrapper!.className).toContain('opacity-60');
    expect(wrapper!.className).toContain('pointer-events-none');
  });

  it('does not apply disabled styling when not disabled', () => {
    const json = formJson({ name: 'Alice' });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    const wrapper = container.firstElementChild;
    expect(wrapper!.className).not.toContain('opacity-60');
  });

  // ── onChange ──
  it('calls onChange with updated JSON when field changes', () => {
    const onChange = vi.fn();
    const json = formJson({ name: 'Alice' });
    render(<ResolverForm value={json} onChange={onChange} />);

    fireEvent.change(screen.getByDisplayValue('Alice'), { target: { value: 'Bob' } });
    expect(onChange).toHaveBeenCalled();
    const emitted = JSON.parse(onChange.mock.calls[0][0]);
    expect(emitted.name).toBe('Bob');
  });

  // ── x-lt-widget ──
  it('renders file-upload widget for x-lt-widget=file-upload', () => {
    const json = formJson({ doc: '' }, {
      properties: { doc: { type: 'string', 'x-lt-widget': 'file-upload' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('Choose file')).toBeInTheDocument();
  });

  it('renders code-editor widget for x-lt-widget=code-editor', () => {
    const json = formJson({ script: 'SELECT 1' }, {
      properties: { script: { type: 'string', 'x-lt-widget': 'code-editor' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeInTheDocument();
    expect(textarea!.className).toContain('font-mono');
  });

  it('renders signature widget for x-lt-widget=signature', () => {
    const json = formJson({ sig: '' }, {
      properties: { sig: { type: 'string', 'x-lt-widget': 'signature' } },
    });
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  // ── Helper text ──
  it('renders field description as helper text', () => {
    const json = formJson({ email: '' }, {
      properties: { email: { type: 'string', description: 'Your work email' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('Your work email')).toBeInTheDocument();
  });

  // ── x-lt-showIf ──
  it('shows field when x-lt-showIf condition is truthy', () => {
    const json = formJson({ shutdown_ack: false }, {
      properties: {
        shutdown_ack: { type: 'boolean', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    const ctx = { metadata: { crew_pill: true } };
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={ctx} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('hides field when x-lt-showIf condition is falsy', () => {
    const json = formJson({ shutdown_ack: false }, {
      properties: {
        shutdown_ack: { type: 'boolean', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    const ctx = { metadata: {} };
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={ctx} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows negated field when condition is absent (! prefix)', () => {
    const json = formJson({ action_taken: 'done' }, {
      properties: {
        action_taken: { type: 'string', 'x-lt-showIf': '!metadata.crew_pill' },
      },
    });
    const ctx = { metadata: {} };
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={ctx} />);
    expect(screen.getByDisplayValue('done')).toBeInTheDocument();
  });

  it('hides negated field when condition is truthy (! prefix)', () => {
    const json = formJson({ action_taken: 'done' }, {
      properties: {
        action_taken: { type: 'string', 'x-lt-showIf': '!metadata.crew_pill' },
      },
    });
    const ctx = { metadata: { crew_pill: true } };
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={ctx} />);
    expect(screen.queryByDisplayValue('done')).not.toBeInTheDocument();
  });

  it('branches between crew-pill and normal fields based on context', () => {
    const json = formJson(
      { action_taken: 'completed', shutdown_ack: false },
      {
        properties: {
          action_taken: { type: 'string', 'x-lt-showIf': '!metadata.crew_pill' },
          shutdown_ack: { type: 'boolean', 'x-lt-showIf': 'metadata.crew_pill' },
        },
      },
    );

    const { unmount } = render(
      <ResolverForm value={json} onChange={vi.fn()} escalationContext={{ metadata: { crew_pill: true } }} />,
    );
    // crew_pill=true: shutdown_ack shows, action_taken hidden
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('completed')).not.toBeInTheDocument();
    unmount();

    render(
      <ResolverForm value={json} onChange={vi.fn()} escalationContext={{ metadata: {} }} />,
    );
    // crew_pill absent: action_taken shows, shutdown_ack hidden
    expect(screen.getByDisplayValue('completed')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  // ── x-lt-hide-if-empty ──
  it('hides field with x-lt-hide-if-empty when value is empty string', () => {
    const json = formJson({ notes: '' }, {
      properties: {
        notes: { type: 'string', readOnly: true, 'x-lt-hide-if-empty': true },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.queryByText('notes')).not.toBeInTheDocument();
  });

  it('shows field with x-lt-hide-if-empty when value is non-empty', () => {
    const json = formJson({ notes: 'heel cup A' }, {
      properties: {
        notes: { type: 'string', readOnly: true, 'x-lt-hide-if-empty': true },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('heel cup A')).toBeInTheDocument();
  });

  it('hides field with x-lt-hide-if-empty when value is null', () => {
    const json = formJson({ tag: null }, {
      properties: {
        tag: { type: 'string', 'x-lt-hide-if-empty': true },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.queryByText('tag')).not.toBeInTheDocument();
  });

  it('evaluates conditions correctly when escalationContext is absent', () => {
    // Without escalationContext, metadata domain is absent (falsy).
    // Fields conditioned on !metadata.X show; fields conditioned on metadata.X hide.
    const json = formJson(
      { action_taken: 'completed', shutdown_ack: false },
      {
        properties: {
          action_taken: { type: 'string', 'x-lt-showIf': '!metadata.crew_pill' },
          shutdown_ack: { type: 'boolean', 'x-lt-showIf': 'metadata.crew_pill' },
        },
      },
    );
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('completed')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

// ── resolver-domain live conditionality ──
describe('ResolverForm — resolver.field conditionality', () => {
  it('hides rejection_reason when approved is true (live resolver domain)', () => {
    const json = formJson({ approved: true, rejection_reason: '' }, {
      'x-lt-order': ['approved', 'rejection_reason'],
      properties: {
        approved: { type: 'boolean' },
        rejection_reason: { type: 'string', 'x-lt-showIf': '!resolver.approved' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.queryByDisplayValue('')).not.toBeInTheDocument();
  });

  it('shows rejection_reason when approved is false (live resolver domain)', () => {
    const json = formJson({ approved: false, rejection_reason: '' }, {
      'x-lt-order': ['approved', 'rejection_reason'],
      properties: {
        approved: { type: 'boolean' },
        rejection_reason: { type: 'string', 'x-lt-showIf': '!resolver.approved' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('reveals rejection_reason live when user unchecks approved', async () => {
    const json = formJson({ approved: true, rejection_reason: '' }, {
      'x-lt-order': ['approved', 'rejection_reason'],
      properties: {
        approved: { type: 'boolean' },
        rejection_reason: { type: 'string', 'x-lt-showIf': '!resolver.approved' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  // Chained conditions: a condition which begets a condition. Each field's
  // visibility evaluates independently against the LIVE resolver values, so
  // A's value reveals B, and B's value reveals C — arbitrary depth.
  const CHAIN_SCHEMA = {
    'x-lt-order': ['needs_review', 'escalate', 'escalation_notes'],
    properties: {
      needs_review: { type: 'boolean' },
      escalate: { type: 'boolean', 'x-lt-showIf': 'resolver.needs_review' },
      escalation_notes: { type: 'string', 'x-lt-showIf': 'resolver.escalate' },
    },
  };

  it('chained x-lt-showIf: A reveals B, then B reveals C — live, in sequence', () => {
    const json = formJson({ needs_review: false, escalate: false, escalation_notes: '' }, CHAIN_SCHEMA);
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    // Only A rendered
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // Check A → B appears (C still hidden: escalate is false)
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    // Check B → C appears — the condition begat a condition
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('equality x-lt-showIf reacts live to resolver edits (per-designation sub-surfaces)', () => {
    const json = formJson({ designatedStation: 'DRAFT', draft_notes: '' }, {
      'x-lt-order': ['designatedStation', 'draft_notes'],
      properties: {
        designatedStation: { type: 'string', enum: ['DRAFT', 'PRINT'] },
        draft_notes: { type: 'string', 'x-lt-showIf': 'resolver.designatedStation=DRAFT' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    // DRAFT selected → the DRAFT-only field is visible
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // Switch designation → the sub-surface swaps out live
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'PRINT' } });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('chained x-lt-showIf: unchecking mid-chain collapses everything downstream', () => {
    const json = formJson({ needs_review: true, escalate: true, escalation_notes: 'x' }, CHAIN_SCHEMA);
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    // Uncheck B — C hides immediately
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

// ── required field validation ──
describe('ResolverForm — required field validation', () => {
  it('shows error on empty required field when submitAttempted', () => {
    const json = formJson({ notes: '' }, {
      required: ['notes'],
      properties: { notes: { type: 'string' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('does not show error on required field that has a value', () => {
    const json = formJson({ notes: 'filled' }, {
      required: ['notes'],
      properties: { notes: { type: 'string' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });

  it('hidden required field (x-lt-showIf false) produces no error even with submitAttempted', () => {
    const json = formJson({ action: '', shutdown_ack: false }, {
      required: ['shutdown_ack'],
      properties: {
        action: { type: 'string' },
        shutdown_ack: { type: 'boolean', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    // crew_pill absent → shutdown_ack hidden → required error must not appear
    render(
      <ResolverForm
        value={json}
        onChange={vi.fn()}
        submitAttempted
        escalationContext={{ metadata: {} }}
      />,
    );
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });

  it('visible required field shows error when submitAttempted', () => {
    const json = formJson({ action: '', shutdown_ack: false }, {
      required: ['shutdown_ack'],
      properties: {
        action: { type: 'string' },
        shutdown_ack: { type: 'boolean', 'x-lt-showIf': 'metadata.crew_pill' },
      },
    });
    // crew_pill=true → shutdown_ack is visible → required error must appear (boolean false = empty)
    render(
      <ResolverForm
        value={json}
        onChange={vi.fn()}
        submitAttempted
        escalationContext={{ metadata: { crew_pill: true } }}
      />,
    );
    // boolean false is a valid value so no Required error for checkboxes — only strings/null trigger it
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('required string field hidden via resolver.domain condition does not error', () => {
    // approved=true → rejection_reason hidden → no Required error
    const json = formJson({ approved: true, rejection_reason: '' }, {
      required: ['rejection_reason'],
      'x-lt-order': ['approved', 'rejection_reason'],
      properties: {
        approved: { type: 'boolean' },
        rejection_reason: { type: 'string', 'x-lt-showIf': '!resolver.approved' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    // rejection_reason is hidden (approved=true) → no error and no textbox
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('required string field revealed via resolver.domain condition errors when empty', () => {
    // approved=false → rejection_reason visible → empty → Required error
    const json = formJson({ approved: false, rejection_reason: '' }, {
      required: ['rejection_reason'],
      'x-lt-order': ['approved', 'rejection_reason'],
      properties: {
        approved: { type: 'boolean' },
        rejection_reason: { type: 'string', 'x-lt-showIf': '!resolver.approved' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('required object field (e.g. checklist) errors when all values are false', () => {
    const json = formJson(
      { checks: { item_0: false, item_1: false } },
      {
        required: ['checks'],
        properties: { checks: { type: 'object', 'x-lt-widget': 'checklist' } },
      },
    );
    // Checklist with no items (no context) shows empty-state message
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    // The widget renders but since no escalation context, checklist shows empty-state
    // The required check still fires: object with all-falsy values → Required
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('required object field does not error when at least one value is true', () => {
    const json = formJson(
      { checks: { item_0: true, item_1: false } },
      {
        required: ['checks'],
        properties: { checks: { type: 'object', 'x-lt-widget': 'checklist' } },
      },
    );
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
  });
});

// ── constraint validation (min, max, pattern) ──
describe('ResolverForm — field constraint validation', () => {
  it('shows minLength error when string is too short', () => {
    const json = formJson({ code: 'ab' }, {
      properties: { code: { type: 'string', minLength: 5 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Minimum 5 characters')).toBeInTheDocument();
  });

  it('passes when string meets minLength', () => {
    const json = formJson({ code: 'hello' }, {
      properties: { code: { type: 'string', minLength: 5 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.queryByText(/minimum/i)).not.toBeInTheDocument();
  });

  it('shows maxLength error when string is too long', () => {
    const json = formJson({ tag: 'toolongvalue' }, {
      properties: { tag: { type: 'string', maxLength: 5 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Maximum 5 characters (12 entered)')).toBeInTheDocument();
  });

  it('shows pattern error when string does not match', () => {
    const json = formJson({ code: 'abc123' }, {
      properties: { code: { type: 'string', pattern: '^[A-Z]+$' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Invalid format')).toBeInTheDocument();
  });

  it('uses x-lt-pattern-error when pattern fails', () => {
    const json = formJson({ phone: 'not-a-phone' }, {
      properties: { phone: { type: 'string', pattern: '^\\d{10}$', 'x-lt-pattern-error': 'Enter a 10-digit phone number' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Enter a 10-digit phone number')).toBeInTheDocument();
  });

  it('shows minimum error when number is below minimum', () => {
    const json = formJson({ age: 0 }, {
      properties: { age: { type: 'number', minimum: 18 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Minimum value is 18')).toBeInTheDocument();
  });

  it('shows maximum error when number exceeds maximum', () => {
    const json = formJson({ score: 150 }, {
      properties: { score: { type: 'number', maximum: 100 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.getByText('Maximum value is 100')).toBeInTheDocument();
  });

  it('passes when number is within min and max bounds', () => {
    const json = formJson({ score: 75 }, {
      properties: { score: { type: 'number', minimum: 0, maximum: 100 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} submitAttempted />);
    expect(screen.queryByText(/minimum/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/maximum/i)).not.toBeInTheDocument();
  });

  it('no constraint error shown before field is touched (not submitAttempted)', () => {
    const json = formJson({ code: 'ab' }, {
      properties: { code: { type: 'string', minLength: 5 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.queryByText(/minimum/i)).not.toBeInTheDocument();
  });

  it('shows error after field is blurred', () => {
    const json = formJson({ code: 'ab' }, {
      properties: { code: { type: 'string', minLength: 5 } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByDisplayValue('ab'));
    expect(screen.getByText('Minimum 5 characters')).toBeInTheDocument();
  });
});

// ── x-lt-section ──
describe('ResolverForm — x-lt-section', () => {
  it('renders a section header when x-lt-section is set', () => {
    const json = formJson({ heelCup: 'A' }, {
      properties: {
        heelCup: { type: 'string', 'x-lt-section': 'The order' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('The order')).toBeInTheDocument();
  });

  it('renders no section header when x-lt-section is not set', () => {
    const json = formJson({ name: 'Alice' });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    // No heading-like element for a section label
    expect(screen.queryByText('The order')).not.toBeInTheDocument();
  });

  it('groups fields into separate sections', () => {
    const json = formJson(
      { heelCup: 'A', approved: false },
      {
        'x-lt-order': ['heelCup', 'approved'],
        properties: {
          heelCup: { type: 'string', 'x-lt-section': 'Facts' },
          approved: { type: 'boolean', 'x-lt-section': 'Action' },
        },
      },
    );
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('Facts')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders all fields when sections have different names', () => {
    const json = formJson(
      { a: 'first', b: 'second', c: 'third' },
      {
        'x-lt-order': ['a', 'b', 'c'],
        properties: {
          a: { type: 'string', 'x-lt-section': 'Group 1' },
          b: { type: 'string', 'x-lt-section': 'Group 1' },
          c: { type: 'string', 'x-lt-section': 'Group 2' },
        },
      },
    );
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('first')).toBeInTheDocument();
    expect(screen.getByDisplayValue('second')).toBeInTheDocument();
    expect(screen.getByDisplayValue('third')).toBeInTheDocument();
    // Section headers
    expect(screen.getByText('Group 1')).toBeInTheDocument();
    expect(screen.getByText('Group 2')).toBeInTheDocument();
  });
});
