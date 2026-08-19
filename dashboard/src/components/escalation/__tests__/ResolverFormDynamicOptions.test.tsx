import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../ResolverForm';

// x-lt-options — a select whose option list rides the escalation context.
// Dispatch is by SCHEMA, not runtime value: a number-typed count seeded to 0
// renders as a select; the emitted value keeps the option's own type.

function formJson(fields: Record<string, unknown>, schema?: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...fields };
  if (schema) data._form_schema = schema;
  return JSON.stringify(data, null, 2);
}

const CTX = {
  envelope: {
    left_quantity_options: [0, 1, 2, 3],
    return_stations: ['molding', 'finishing'],
    reject_reasons: [
      { value: 'uuid-1', label: 'Delamination' },
      { id: 'uuid-2', label: 'Warping' },
    ],
  },
};

describe('ResolverForm dynamic options (x-lt-options)', () => {
  it('renders a number field with context options as a select, not a number input', () => {
    const json = formJson({ left_quantity: 0 }, {
      properties: {
        left_quantity: { type: 'number', 'x-lt-options': 'envelope.left_quantity_options' },
      },
    });
    const { container } = render(
      <ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(container.querySelector('input[type="number"]')).not.toBeInTheDocument();
    for (const opt of ['0', '1', '2', '3']) {
      expect(screen.getByRole('option', { name: opt })).toBeInTheDocument();
    }
  });

  it('emits the picked option with its own type — a numeric option stays a number', () => {
    const onChange = vi.fn();
    const json = formJson({ left_quantity: 0 }, {
      properties: {
        left_quantity: { type: 'number', 'x-lt-options': 'envelope.left_quantity_options' },
      },
    });
    render(<ResolverForm value={json} onChange={onChange} escalationContext={CTX} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } });
    const emitted = JSON.parse(onChange.mock.calls[0][0]);
    expect(emitted.left_quantity).toBe(2);
  });

  it('renders string options from the context and keeps them strings', () => {
    const onChange = vi.fn();
    const json = formJson({ designation: '' }, {
      properties: {
        designation: { type: 'string', 'x-lt-options': 'envelope.return_stations' },
      },
    });
    render(<ResolverForm value={json} onChange={onChange} escalationContext={CTX} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'finishing' } });
    const emitted = JSON.parse(onChange.mock.calls[0][0]);
    expect(emitted.designation).toBe('finishing');
  });

  it('shows the disabled Choose… placeholder while the value is outside the options', () => {
    const json = formJson({ designation: '' }, {
      properties: {
        designation: { type: 'string', 'x-lt-options': 'envelope.return_stations' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    const placeholder = screen.getByRole('option', { name: 'Choose…' }) as HTMLOptionElement;
    expect(placeholder.disabled).toBe(true);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });

  it('a value already among the options renders selected with no placeholder', () => {
    const json = formJson({ left_quantity: 3 }, {
      properties: {
        left_quantity: { type: 'number', 'x-lt-options': 'envelope.left_quantity_options' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('3');
    expect(screen.queryByRole('option', { name: 'Choose…' })).not.toBeInTheDocument();
  });

  it('object options show the LABEL and emit the VALUE — a pick list storing its foreign key', () => {
    const onChange = vi.fn();
    const json = formJson({ reason: '' }, {
      properties: {
        reason: { type: 'string', 'x-lt-options': 'envelope.reject_reasons' },
      },
    });
    render(<ResolverForm value={json} onChange={onChange} escalationContext={CTX} />);
    // The submitter reads labels; the uuid never renders as option text.
    expect(screen.getByRole('option', { name: 'Delamination' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Warping' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'uuid-1' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'uuid-2' } });
    const emitted = JSON.parse(onChange.mock.calls[0][0]);
    expect(emitted.reason).toBe('uuid-2');
  });

  it('a stored value renders with its label selected', () => {
    const json = formJson({ reason: 'uuid-1' }, {
      properties: {
        reason: { type: 'string', 'x-lt-options': 'envelope.reject_reasons' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('uuid-1');
    expect(select.selectedOptions[0].text).toBe('Delamination');
    expect(screen.queryByRole('option', { name: 'Choose…' })).not.toBeInTheDocument();
  });

  it('a static enum takes precedence over the dynamic path', () => {
    const json = formJson({ designation: '' }, {
      properties: {
        designation: { type: 'string', enum: ['a', 'b'], 'x-lt-options': 'envelope.return_stations' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    expect(screen.getByRole('option', { name: 'a' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'molding' })).not.toBeInTheDocument();
  });

  it('an unresolvable path falls back to the plain input for the declared type', () => {
    const json = formJson({ left_quantity: 0, note: '' }, {
      properties: {
        left_quantity: { type: 'number', 'x-lt-options': 'envelope.missing' },
        note: { type: 'string', 'x-lt-options': 'envelope.also_missing' },
      },
    });
    const { container } = render(
      <ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="number"]')).toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')).toBeInTheDocument();
  });

  // ── Ordered sources (first-resolvable-wins) ──

  it('an ordered token renders from the envelope fallback when the lookup is absent — a real dropdown', () => {
    const json = formJson({ reason: '' }, {
      properties: {
        reason: { type: 'string', 'x-lt-options': ['lookup.reasons.items', 'envelope.reject_reasons'] },
      },
    });
    const ctx = { envelope: { reject_reasons: [{ value: 'uuid-1', label: 'Delamination' }] } };
    const { container } = render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={ctx} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Delamination' })).toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')).not.toBeInTheDocument();
  });

  it('an all-plain-path miss keeps the typed plain-input fallback', () => {
    const json = formJson({ reason: '' }, {
      properties: {
        reason: { type: 'string', 'x-lt-options': ['lookup.reasons.items', 'envelope.reject_reasons'] },
      },
    });
    const { container } = render(
      <ResolverForm value={json} onChange={vi.fn()} escalationContext={{ envelope: {} }} />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')).toBeInTheDocument();
  });

  it('an interpolated entry keeps the disabled-select contract when nothing resolves', () => {
    const json = formJson({ region: '' }, {
      properties: {
        region: {
          type: 'string',
          'x-lt-options': ['lookup.geo.regions.{{resolver.country}}', 'envelope.geo.regions.{{resolver.country}}'],
        },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={{ envelope: {} }} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });
});
