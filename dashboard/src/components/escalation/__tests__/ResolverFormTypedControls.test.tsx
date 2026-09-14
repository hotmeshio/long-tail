import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResolverForm } from '../ResolverForm';

// The control follows the declared type and its tokens; the stored value only fills it.

const formJson = (values: Record<string, unknown>, schema: Record<string, unknown>) =>
  JSON.stringify({ _form_schema: schema, ...values });

describe('ResolverForm typed controls', () => {
  it('an unanswered number renders a number input that emits numbers', () => {
    const onChange = vi.fn();
    const json = formJson({ copies: '', count: '' }, {
      properties: { copies: { type: 'number' }, count: { type: 'integer' } },
    });
    render(<ResolverForm value={json} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: '4' } });
    expect(JSON.parse(onChange.mock.calls[0][0]).copies).toBe(4);
  });

  it('an unanswered boolean renders an unchecked box; with options it renders a Yes/No select emitting booleans', () => {
    const onChange = vi.fn();
    const json = formJson({ force: '', powerCycled: null }, {
      properties: {
        force: { type: 'boolean' },
        powerCycled: { type: 'boolean', 'x-lt-options': [{ value: true, label: 'Yes' }, { value: false, label: 'No' }] },
      },
    });
    render(<ResolverForm value={json} onChange={onChange} />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'false' } });
    expect(JSON.parse(onChange.mock.calls[0][0]).powerCycled).toBe(false);
  });

  it('inline labeled options render labels and emit values without a context', () => {
    const onChange = vi.fn();
    const json = formJson({ role: '' }, {
      properties: { role: { type: 'string', 'x-lt-options': [{ value: 'rn', label: 'Registered Nurse' }] } },
    });
    render(<ResolverForm value={json} onChange={onChange} />);
    expect(screen.getByRole('option', { name: 'Registered Nurse' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rn' } });
    expect(JSON.parse(onChange.mock.calls[0][0]).role).toBe('rn');
  });

  it('a list with its own x-lt-options renders chips and emits the picks in list order', () => {
    const onChange = vi.fn();
    const json = formJson({ roles: ['qa'] }, {
      properties: { roles: { type: 'array', 'x-lt-options': [{ value: 'gluer', label: 'Gluer' }, { value: 'finisher', label: 'Finisher' }, { value: 'qa', label: 'QA' }] } },
    });
    render(<ResolverForm value={json} onChange={onChange} />);
    expect(screen.getByRole('group', { name: 'roles' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('multi-select-roles-gluer'));
    expect(JSON.parse(onChange.mock.calls[0][0]).roles).toEqual(['gluer', 'qa']);
  });

  it('a list from an interpolated path with no parent answer renders with no options yet', () => {
    const json = formJson({ trays: [], zone: '' }, {
      properties: {
        zone: { type: 'string' },
        trays: { type: 'array', 'x-lt-options': 'envelope.trays.{{resolver.zone}}' },
      },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={{ envelope: { trays: { north: ['t1'] } } }} />);
    expect(screen.getByText('No options yet')).toBeInTheDocument();
  });

  it('the json editor emits parsed values, null for empty text, and the raw text while invalid', () => {
    const onChange = vi.fn();
    const json = formJson({ mix: {} }, {
      properties: { mix: { type: 'object', 'x-lt-widget': 'json' } },
    });
    render(<ResolverForm value={json} onChange={onChange} />);
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"bag": 1' } });
    expect(JSON.parse(onChange.mock.calls[0][0]).mix).toBe('{"bag": 1');
    fireEvent.change(editor, { target: { value: '{"bag": 1}' } });
    expect(JSON.parse(onChange.mock.calls[1][0]).mix).toEqual({ bag: 1 });
    fireEvent.change(editor, { target: { value: '' } });
    expect(JSON.parse(onChange.mock.calls[2][0]).mix).toBeNull();
  });

  it('a list without options stays display only and long text still opens a textarea', () => {
    const json = formJson({ tags: ['a', 'b'], note: 'x'.repeat(120) }, {
      properties: { tags: { type: 'array' }, note: { type: 'string' } },
    });
    render(<ResolverForm value={json} onChange={vi.fn()} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByLabelText('tags')).not.toBeInTheDocument();
    expect(screen.getByLabelText('note').tagName).toBe('TEXTAREA');
  });
});
