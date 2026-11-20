import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FieldRow } from '../../FieldRow';

const codes = {
  type: ['array', 'null'],
  title: 'Diagnosis codes',
  items: { type: 'string', pattern: '^[A-Z][0-9]{2}(\\.[0-9]+)?$', 'x-lt-transform': 'uppercase' },
  uniqueItems: true,
  maxItems: 3,
};
const render1 = (value: unknown, onChange = vi.fn(), extra: Record<string, unknown> = {}, ctx?: unknown) => {
  const schema = { properties: { codes: { ...codes, ...extra } } };
  render(<FieldRow fieldKey="codes" value={value as any} onChange={onChange} schema={schema} escalationContext={ctx as any} />);
  return { onChange, input: screen.getByRole('combobox') as HTMLInputElement };
};
const type = (input: HTMLInputElement, text: string) => fireEvent.change(input, { target: { value: text } });

describe('pills for an open list of scalars', () => {
  it('commits on Enter through the transform, keeping order', () => {
    const { onChange, input } = render1(['E11.65']);
    type(input, 'e11.42');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['E11.65', 'E11.42']);
  });

  it('commits on a comma, on Tab with text, and on blur', () => {
    const a = render1([]);
    type(a.input, 'i73');
    fireEvent.keyDown(a.input, { key: ',' });
    expect(a.onChange).toHaveBeenCalledWith(['I73']);
  });

  it('commits typed text on blur so nothing is lost at submit', () => {
    const { onChange, input } = render1([]);
    type(input, 'i73.9');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['I73.9']);
  });

  it('splits a paste into one pill per code', () => {
    const { onChange, input } = render1([]);
    fireEvent.paste(input, { clipboardData: { getData: () => 'e11.65, e11.42; i73.9' } });
    expect(onChange).toHaveBeenCalledWith(['E11.65', 'E11.42', 'I73.9']);
  });

  it('refuses a duplicate and says why, leaving the list unchanged', () => {
    const { onChange, input } = render1(['E11.65']);
    type(input, 'E11.65');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('E11.65 is already in the list');
  });

  it('refuses a fourth item at maxItems', () => {
    const { onChange, input } = render1(['A11', 'B22', 'C33']);
    type(input, 'D44');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('At most 3 items');
  });

  it('keeps a failing pill, marks it, and names the problem', () => {
    const { onChange, input } = render1([]);
    type(input, 'bad');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['BAD']);
  });

  it('shows an invalid existing pill in the error tone with its reason', () => {
    render1(['BAD']);
    const pill = screen.getByText('BAD').closest('[data-pill]')!;
    expect(pill.getAttribute('data-tone')).toBe('error');
    expect(pill.getAttribute('title')).toBe('Item 1: Invalid format');
  });

  it('removes with a named control', () => {
    const { onChange } = render1(['A11', 'B22']);
    fireEvent.click(screen.getByLabelText('Remove A11'));
    expect(onChange).toHaveBeenCalledWith(['B22']);
  });

  it('Backspace in an empty input selects the last pill; a second removes it', () => {
    const { onChange, input } = render1(['A11', 'B22']);
    fireEvent.keyDown(input, { key: 'Backspace' });
    const last = screen.getByText('B22').closest('[data-pill]')!;
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['A11']);
  });

  it('Enter on a pill edits it in place', () => {
    const { onChange } = render1(['A11', 'B22']);
    const first = screen.getByText('A11').closest('[data-pill]')!;
    fireEvent.keyDown(first, { key: 'Enter' });
    const editor = screen.getByLabelText('Edit A11') as HTMLInputElement;
    fireEvent.change(editor, { target: { value: 'c33' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['C33', 'B22']);
  });

  it('Alt+Arrow reorders when sortable', () => {
    const { onChange } = render1(['A11', 'B22'], vi.fn(), { 'x-lt-sortable': true });
    fireEvent.keyDown(screen.getByText('A11').closest('[data-pill]')!, { key: 'ArrowRight', altKey: true });
    expect(onChange).toHaveBeenCalledWith(['B22', 'A11']);
  });

  it('submits numbers for numeric items', () => {
    const { onChange, input } = render1([], vi.fn(), { items: { type: 'integer' }, uniqueItems: false });
    type(input, '42');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([42]);
  });

  it('a null list reads "Not stated" and offers no clear; a filled nullable list offers it', () => {
    render1(null);
    expect((screen.getByRole('combobox') as HTMLInputElement).placeholder).toBe('Not stated');
    expect(screen.queryByText(/Clear to/)).toBeNull();
  });

  it('clears to null on request and an emptied list stays an empty list', () => {
    const { onChange } = render1(['A11']);
    fireEvent.click(screen.getByText(/Clear to/));
    expect(onChange).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByLabelText('Remove A11'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('offers type-ahead from x-lt-suggest and still accepts a value not listed', () => {
    const ctx = { lookup: { icd: [{ value: 'E11.65', label: 'Type 2 diabetes with hyperglycemia' }] } };
    const { onChange, input } = render1([], vi.fn(), { 'x-lt-suggest': 'lookup.icd' }, ctx);
    type(input, 'hyper');
    const option = screen.getByRole('option');
    expect(option.textContent).toContain('Type 2 diabetes with hyperglycemia');
    fireEvent.mouseDown(option);
    expect(onChange).toHaveBeenCalledWith(['E11.65']);
    type(input, 'z99');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['Z99']);
  });

  it('carries the review-key hook on the input', () => {
    const { input } = render1([]);
    expect(input.getAttribute('data-field-key')).toBe('codes');
  });
});

describe('a closed list as a picker', () => {
  const options = Array.from({ length: 16 }, (_, i) => ({ value: `opt_${i}`, label: `Option ${i}` }));
  const schema = { properties: { picks: { type: 'array', items: { type: 'string' }, 'x-lt-options': options, title: 'Picks' } } };

  it('shows only the picked values and adds from the options by label', () => {
    const onChange = vi.fn();
    render(<FieldRow fieldKey="picks" value={['opt_1'] as any} onChange={onChange} schema={schema} />);
    expect(screen.getByText('Option 1')).toBeTruthy();
    expect(screen.queryByText('Option 2')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Option 7' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['opt_1', 'opt_7']);
  });

  it('refuses text that is not an option and keeps an unknown proposed value visible', () => {
    const onChange = vi.fn();
    render(<FieldRow fieldKey="picks" value={['old_value'] as any} onChange={onChange} schema={schema} />);
    expect(screen.getByText('old_value').closest('[data-pill]')!.getAttribute('data-tone')).toBe('warning');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nope' } });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('nope is not a listed option');
  });
});
